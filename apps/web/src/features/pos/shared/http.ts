"use client";

// Generic POS fetch client every capability's own api file builds on top
// of, the same way CRM's per-object api files (e.g. accounts-api.ts) each
// wrap a shared request helper rather than hand-rolling fetch/error
// handling per file.
export class PosApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new PosApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload.details);
  }
  return payload;
}

export function request<T>(path: string, init?: RequestInit): Promise<T> {
  return fetch(`/api/pos${path}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers || {}) },
    ...init,
  }).then(parseResponse<T>);
}
export const post = <T,>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
export const del = <T,>(path: string) => request<T>(path, { method: "DELETE" });
