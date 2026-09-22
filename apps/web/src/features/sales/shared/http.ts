"use client";

export class SalesApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    // The route layer's fail() spreads error details flat into the JSON body
    // (not nested under a "details" key), so this is the raw response payload
    // -- read extra fields (e.g. `matches` on a duplicate-block error) off it
    // directly.
    public readonly payload?: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new SalesApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  }
  return payload;
}

export function request<T>(path: string, init?: RequestInit): Promise<T> {
  return fetch(`/api/sales${path}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers || {}) },
    ...init,
  }).then(parseResponse<T>);
}
export const post = <T,>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
export const del = <T,>(path: string) => request<T>(path, { method: "DELETE" });
