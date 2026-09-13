import {
  CORRELATION_HEADER,
  IDEMPOTENCY_KEY_HEADER,
  type ApiErrorEnvelope,
} from '@vercentlabs/contracts';

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly envelope: ApiErrorEnvelope,
  ) {
    super(envelope.error.message);
    this.name = 'ApiRequestError';
  }
}

export interface ApiClientOptions {
  /** Versioned API base URL, e.g. "http://localhost:3001/api/v1". */
  baseUrl: string;
  getCorrelationId?: () => string | undefined;
  fetchImpl?: typeof fetch;
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/**
 * Thin typed wrapper over `fetch` for calling the versioned `/api/v1`
 * contract from apps/web. This client never performs ERP domain mutations
 * itself; it only carries requests to apps/api, which owns authorization and
 * validation. See root governance rule 4.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly getCorrelationId: (() => string | undefined) | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.getCorrelationId = options.getCorrelationId;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async request<T>(options: ApiRequestOptions): Promise<T> {
    const url = new URL(this.baseUrl + options.path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const correlationId = this.getCorrelationId?.();
    if (correlationId) {
      headers[CORRELATION_HEADER] = correlationId;
    }
    if (options.idempotencyKey) {
      headers[IDEMPOTENCY_KEY_HEADER] = options.idempotencyKey;
    }

    const requestInit: RequestInit = {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : null,
    };
    if (options.signal) {
      requestInit.signal = options.signal;
    }

    const response = await this.fetchImpl(url.toString(), requestInit);

    if (!response.ok) {
      const envelope = (await response.json().catch(() => null)) as ApiErrorEnvelope | null;
      throw new ApiRequestError(
        response.status,
        envelope ?? { error: { code: 'INTERNAL_ERROR', message: response.statusText } },
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}
