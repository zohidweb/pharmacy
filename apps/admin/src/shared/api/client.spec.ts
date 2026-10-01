/**
 * @jest-environment node
 */
import { ApiError, apiRequest } from './client';

const jsonResponse = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

describe('apiRequest', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });
  afterEach(() => fetchSpy.mockRestore());

  it('calls the same-origin /api/v1 route with JSON and a correlation id', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(201, {
        operator: { id: 'op-1' },
        authenticatedAt: '2026-10-01T05:00:00Z',
      }),
    );

    const session = await apiRequest('operator.sessions.create', {
      body: { login: 'operator@example.test', password: 'x' },
    });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('/api/v1/operator/sessions');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-Correlation-Id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(init.body as string)).toEqual({
      login: 'operator@example.test',
      password: 'x',
    });
    expect(session.operator.id).toBe('op-1');
  });

  it('maps problem+json to ApiError with code, field errors and the server correlation id', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(
        422,
        {
          status: 422,
          code: 'validation_failed',
          errors: [{ field: 'login', code: 'format' }],
        },
        { 'X-Correlation-Id': 'server-id' },
      ),
    );

    const error = await apiRequest('operator.sessions.current').catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 422,
      code: 'validation_failed',
      correlationId: 'server-id',
      errors: [{ field: 'login', code: 'format' }],
    });
  });

  it('reports network failures as ApiError status 0 "network"', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(apiRequest('operator.sessions.current')).rejects.toMatchObject(
      {
        status: 0,
        code: 'network',
      },
    );
  });

  it('returns undefined for 204 No Content', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      apiRequest('operator.sessions.delete'),
    ).resolves.toBeUndefined();
  });
});
