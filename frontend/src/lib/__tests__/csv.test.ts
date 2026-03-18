import { downloadSubscriptionsCsv } from '../csv';

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
