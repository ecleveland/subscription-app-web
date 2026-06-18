import {
  downloadSubscriptionsCsv,
  parseCsv,
  parseAmountToCents,
  deriveImportRows,
  type ColumnMapping,
} from '../csv';

const OriginalURL = globalThis.URL;

describe('downloadSubscriptionsCsv', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let createElementSpy: ReturnType<typeof vi.spyOn>;
  let appendChildSpy: ReturnType<typeof vi.spyOn>;
  let removeChildSpy: ReturnType<typeof vi.spyOn>;
  let createObjectURLMock: ReturnType<typeof vi.fn>;
  let revokeObjectURLMock: ReturnType<typeof vi.fn>;

  const mockAnchor = {
    href: '',
    download: '',
    click: vi.fn(),
  } as unknown as HTMLAnchorElement;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(mockAnchor);
    appendChildSpy = vi
      .spyOn(document.body, 'appendChild')
      .mockReturnValue(mockAnchor);
    removeChildSpy = vi
      .spyOn(document.body, 'removeChild')
      .mockReturnValue(mockAnchor);

    createObjectURLMock = vi.fn().mockReturnValue('blob:test');
    revokeObjectURLMock = vi.fn();
    vi.stubGlobal(
      'URL',
      Object.assign(OriginalURL, {
        createObjectURL: createObjectURLMock,
        revokeObjectURL: revokeObjectURLMock,
      }),
    );

    localStorage.setItem('token', 'test-token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('should call fetch with correct URL and auth header', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['csv-data'])),
    });

    await downloadSubscriptionsCsv('sortBy=name&sortOrder=asc');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/subscriptions/export?sortBy=name&sortOrder=asc'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    );
  });

  it('should create and click a download link', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['csv-data'])),
    });

    await downloadSubscriptionsCsv('');

    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(mockAnchor.download).toBe('subscriptions.csv');
    expect(mockAnchor.click).toHaveBeenCalled();
    expect(appendChildSpy).toHaveBeenCalledWith(mockAnchor);
    expect(removeChildSpy).toHaveBeenCalledWith(mockAnchor);
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:test');
  });

  it('should throw on non-ok response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
    });

    await expect(downloadSubscriptionsCsv('')).rejects.toThrow(
      'Export failed: 401',
    );
  });
});

describe('parseCsv', () => {
  it('parses headers and rows keyed by header', () => {
    const { headers, rows } = parseCsv(
      'Date,Amount,Payee\n2026-06-01,-42.00,Store',
    );
    expect(headers).toEqual(['Date', 'Amount', 'Payee']);
    expect(rows).toEqual([
      { Date: '2026-06-01', Amount: '-42.00', Payee: 'Store' },
    ]);
  });

  it('handles quoted fields with commas and escaped quotes', () => {
    const { rows } = parseCsv(
      'Payee,Amount\n"Acme, Inc.",10.00\n"She said ""hi""",20.00',
    );
    expect(rows[0].Payee).toBe('Acme, Inc.');
    expect(rows[1].Payee).toBe('She said "hi"');
  });

  it('handles newlines inside quoted fields', () => {
    const { rows } = parseCsv('Note,Amount\n"line1\nline2",5.00');
    expect(rows[0].Note).toBe('line1\nline2');
    expect(rows).toHaveLength(1);
  });

  it('tolerates CRLF line endings and a trailing newline', () => {
    const { headers, rows } = parseCsv('A,B\r\n1,2\r\n');
    expect(headers).toEqual(['A', 'B']);
    expect(rows).toEqual([{ A: '1', B: '2' }]);
  });

  it('drops blank lines and fills missing cells', () => {
    const { rows } = parseCsv('A,B,C\n1,2\n\n3,4,5');
    expect(rows).toEqual([
      { A: '1', B: '2', C: '' },
      { A: '3', B: '4', C: '5' },
    ]);
  });

  it('returns an empty result for empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
  });
});

// Mirror of the backend's csv-import.util.spec.ts cases — keep in lockstep with
// backend/src/transactions/csv-import.util.ts so the import preview matches what
// the server will actually do.
describe('parseAmountToCents', () => {
  it.each([
    ['1234.56', 123456],
    ['$1,234.56', 123456],
    ['1234.5', 123450],
    ['50', 5000],
    ['0.07', 7],
    ['-50.00', -5000],
    ['+50', 5000],
    ['(1,234.56)', -123456],
    ['$ (12.30)', -1230],
    ['  $1,000  ', 100000],
    ['1.1', 110],
    ['19.99', 1999],
    ['0.1', 10],
  ])('parses %s -> %d cents', (input, expected) => {
    expect(parseAmountToCents(input)).toBe(expected);
  });

  it.each([['', null], ['abc', null], ['1.2.3', null], ['--5', null], ['$', null], ['12-34', null]])(
    'rejects %s as unparseable',
    (input, expected) => {
      expect(parseAmountToCents(input)).toBe(expected);
    },
  );

  it('returns null for non-string input', () => {
    expect(parseAmountToCents(undefined)).toBeNull();
    expect(parseAmountToCents(42 as unknown as string)).toBeNull();
  });
});

describe('deriveImportRows', () => {
  const mapping: ColumnMapping = {
    date: 'Date',
    amount: 'Amount',
    payee: 'Payee',
  };
  const row = (Date: string, Amount: string, Payee = '') => ({ Date, Amount, Payee });

  it('derives expense from a negative amount and income from a positive one', () => {
    const derived = deriveImportRows(
      [row('2026-06-01', '-42.00', 'Store'), row('2026-06-02', '100.00', 'Job')],
      mapping,
    );
    expect(derived[0]).toMatchObject({
      index: 0,
      status: 'ok',
      type: 'expense',
      amountCents: 4200,
      payee: 'Store',
    });
    expect(derived[1]).toMatchObject({
      index: 1,
      status: 'ok',
      type: 'income',
      amountCents: 10000,
      payee: 'Job',
    });
  });

  it('flags unparseable amount, zero amount, and unparseable date as errors', () => {
    const derived = deriveImportRows(
      [row('2026-06-01', 'abc'), row('2026-06-01', '0'), row('not-a-date', '5.00')],
      mapping,
    );
    expect(derived[0]).toMatchObject({ index: 0, status: 'error', error: 'Unparseable amount' });
    expect(derived[1]).toMatchObject({ index: 1, status: 'error', error: 'Zero amount' });
    expect(derived[2]).toMatchObject({ index: 2, status: 'error', error: 'Unparseable date' });
  });

  it('marks a within-batch duplicate (same date/amount/type/payee) as duplicate', () => {
    const derived = deriveImportRows(
      [row('2026-06-01', '-10.00', 'Store'), row('2026-06-01', '-10.00', 'Store')],
      mapping,
    );
    expect(derived[0].status).toBe('ok');
    expect(derived[1].status).toBe('duplicate');
  });

  it('does not treat rows with differing payees as duplicates', () => {
    const derived = deriveImportRows(
      [row('2026-06-01', '-10.00', 'A'), row('2026-06-01', '-10.00', 'B')],
      mapping,
    );
    expect(derived.map((d) => d.status)).toEqual(['ok', 'ok']);
  });

  it('does not treat rows with differing dates as duplicates', () => {
    const derived = deriveImportRows(
      [row('2026-06-01', '-10.00', 'Store'), row('2026-06-02', '-10.00', 'Store')],
      mapping,
    );
    expect(derived.map((d) => d.status)).toEqual(['ok', 'ok']);
  });

  it('omits payee when no payee column is mapped, and dedupes on empty payee', () => {
    const noPayee: ColumnMapping = { date: 'Date', amount: 'Amount' };
    const derived = deriveImportRows(
      [row('2026-06-01', '-10.00', 'ignored'), row('2026-06-01', '-10.00', 'also-ignored')],
      noPayee,
    );
    expect(derived[0].payee).toBeUndefined();
    expect(derived[1].status).toBe('duplicate');
  });

  it('preserves the original row index across error rows', () => {
    const derived = deriveImportRows(
      [row('2026-06-01', 'abc'), row('2026-06-02', '-5.00', 'Store')],
      mapping,
    );
    expect(derived[1].index).toBe(1);
  });
});
