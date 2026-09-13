import { describe, expect, it } from 'vitest';
import type { ApiClient } from '@vercentlabs/api-client';
import { getApiStatus } from '../lib/get-api-status.js';

function fakeClient(shouldSucceed: boolean): ApiClient {
  return {
    request: async () => {
      if (!shouldSucceed) throw new Error('network error');
      return { status: 'ok' };
    },
  } as unknown as ApiClient;
}

describe('getApiStatus', () => {
  it('returns "ok" when the API health check succeeds', async () => {
    await expect(getApiStatus(fakeClient(true))).resolves.toBe('ok');
  });

  it('returns "unreachable" when the API health check fails', async () => {
    await expect(getApiStatus(fakeClient(false))).resolves.toBe('unreachable');
  });
});
