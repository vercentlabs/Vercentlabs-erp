import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiRequestError } from '../src/api-client.js';

function fakeFetch(response: { status: number; body: unknown }) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;
}

describe('ApiClient', () => {
  it('sends the correlation id and idempotency key headers', async () => {
    const fetchImpl = fakeFetch({ status: 200, body: { id: '1' } });
    const client = new ApiClient({
      baseUrl: 'http://localhost:3001/api/v1',
      getCorrelationId: () => 'req-abc123',
      fetchImpl,
    });

    await client.request({
      method: 'POST',
      path: '/widgets',
      body: { name: 'x' },
      idempotencyKey: 'idem-abc123',
    });

    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-correlation-id']).toBe('req-abc123');
    expect(headers['idempotency-key']).toBe('idem-abc123');
  });

  it('parses a typed error envelope on failure', async () => {
    const fetchImpl = fakeFetch({
      status: 409,
      body: { error: { code: 'CONFLICT', message: 'Already exists' } },
    });
    const client = new ApiClient({ baseUrl: 'http://localhost:3001/api/v1', fetchImpl });

    await expect(client.request({ path: '/widgets' })).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ApiRequestError);
      expect((error as ApiRequestError).status).toBe(409);
      expect((error as ApiRequestError).envelope.error.code).toBe('CONFLICT');
      return true;
    });
  });

  it('returns undefined for a 204 response', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 204 }),
    ) as unknown as typeof fetch;
    const client = new ApiClient({ baseUrl: 'http://localhost:3001/api/v1', fetchImpl });

    await expect(client.request({ method: 'DELETE', path: '/widgets/1' })).resolves.toBeUndefined();
  });
});
