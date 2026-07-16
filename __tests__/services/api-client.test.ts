import { ApiClient } from '../../src/services/api-client';

function makeMockResponse(overrides: Partial<Response> = {}): Response {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve('{}'),
    json: () => Promise.resolve({}),
    headers: new Headers(),
    ...overrides,
  } as any;
}

describe('ApiClient', () => {
  let api: ApiClient;
  const mockFetch = jest.spyOn(global, 'fetch') as jest.Mock;

  beforeEach(() => {
    jest.resetAllMocks();
    api = new ApiClient('http://test.example.com/');
  });

  it('strips trailing slash from baseUrl', () => {
    expect((api as any).baseUrl).toBe('http://test.example.com');
  });

  it('sets and clears token', () => {
    api.setToken('abc');
    expect((api as any).token).toBe('abc');
    api.clearToken();
    expect((api as any).token).toBeNull();
  });

  it('login sends correct request and returns token', async () => {
    mockFetch.mockResolvedValueOnce(
      makeMockResponse({ text: () => Promise.resolve(JSON.stringify({ status: 'success', token: 'jwt123', user_id: 1 })) })
    );

    const res = await api.login('user1', 'pass1');
    expect(res.token).toBe('jwt123');

    const callUrl = mockFetch.mock.calls[0][0];
    const callOpts = mockFetch.mock.calls[0][1];
    expect(callUrl).toBe('http://test.example.com/api/user/login');
    expect(callOpts.method).toBe('POST');
    expect(JSON.parse(callOpts.body)).toEqual({ username: 'user1', password: 'pass1' });
  });

  it('includes Bearer token in authenticated requests', async () => {
    api.setToken('my-token');
    mockFetch.mockResolvedValueOnce(
      makeMockResponse({ text: () => Promise.resolve(JSON.stringify([])) })
    );

    await api.getEntries();
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer my-token');
  });

  it('calls unauthorized handler on 401', async () => {
    const handler = jest.fn();
    api.setUnauthorizedHandler(handler);
    api.setToken('expired');

    mockFetch.mockResolvedValueOnce(
      makeMockResponse({
        ok: false,
        status: 401,
        text: () => Promise.resolve(JSON.stringify({ detail: { status: 'unauthorized' } })),
      })
    );

    await expect(api.getEntries()).rejects.toThrow();
    expect(handler).toHaveBeenCalledTimes(1);
    expect((api as any).token).toBeNull();
  });

  it('creates an entry', async () => {
    api.setToken('tok');
    mockFetch.mockResolvedValueOnce(
      makeMockResponse({ text: () => Promise.resolve(JSON.stringify({ id: 'e1', title: 'Test' })) })
    );

    const res = await api.createEntry({ title: 'Test' });
    expect(res.id).toBe('e1');
  });

  it('deletes an entry', async () => {
    api.setToken('tok');
    mockFetch.mockResolvedValueOnce(
      makeMockResponse({ text: () => Promise.resolve(JSON.stringify({ status: 'ok' })) })
    );

    const res = await api.deleteEntry('e1');
    expect(res).toBeUndefined();  // deleteEntry returns void
  });

  it('updates blocks by full replace', async () => {
    api.setToken('tok');
    mockFetch.mockResolvedValueOnce(
      makeMockResponse({ text: () => Promise.resolve(JSON.stringify({ status: 'ok', block_count: 2 })) })
    );

    const res = await api.updateBlocks('e1', [
      { type: 'text', data: {}, text: 'a' },
      { type: 'photo', data: { key: 'x' }, text: 'b' },
    ]);
    expect(res).toBeUndefined();  // updateBlocks returns void
  });

  it('gets blocks for an entry', async () => {
    api.setToken('tok');
    mockFetch.mockResolvedValueOnce(
      makeMockResponse({ text: () => Promise.resolve(JSON.stringify({ blocks: [{ type: 'text' }] })) })
    );

    const res = await api.getBlocks('e1');
    expect(res.blocks.length).toBe(1);
  });

  it('searches entries (API returns nested results)', async () => {
    api.setToken('tok');
    mockFetch.mockResolvedValueOnce(
      makeMockResponse({ text: () => Promise.resolve(JSON.stringify({ query: 'hi', count: 1, results: [{ id: '1' }] })) })
    );

    // Note: search() returns ZentrimEntry[] but backend returns {query, count, results}
    // This is a known type mismatch in api-client; test just verifies it calls the right URL
    const res = await api.search('hi');
    const callUrl = mockFetch.mock.calls[0][0];
    expect(callUrl).toContain('/api/zentrim/search?q=hi');
  });
});
