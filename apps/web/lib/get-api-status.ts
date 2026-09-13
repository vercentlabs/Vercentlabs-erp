import type { ApiClient } from '@vercentlabs/api-client';

export type ApiStatus = 'ok' | 'unreachable';

/**
 * Checks real API liveness for the foundation page. This is a genuine
 * dependency check, not sample/mock ERP data - see root governance rules 2
 * and 14.
 */
export async function getApiStatus(client: ApiClient): Promise<ApiStatus> {
  try {
    await client.request({ path: '/health/live' });
    return 'ok';
  } catch {
    return 'unreachable';
  }
}
