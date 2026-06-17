import { downloadSubscriptionsCsv, parseCsv } from '../csv';

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
