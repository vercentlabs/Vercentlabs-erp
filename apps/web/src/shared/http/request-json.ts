// Browser-side JSON request for the app's own API routes. Throws the
// server's safe message on any non-2xx or `ok: false` response, so TanStack
// Query surfaces it through onError instead of treating a 403 as success.
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

export async function requestJson<T>(url: string, init?: RequestInit & { json?: unknown }, fallbackMessage = "Something went wrong."): Promise<T> {
  const { json, ...rest } = init ?? {};
  const response = await fetch(url, json === undefined ? rest : { ...rest, headers: { "Content-Type": "application/json", ...rest.headers }, body: JSON.stringify(json) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) throw new RequestError(payload?.message || fallbackMessage, response.status, payload?.code);
  return payload as T;
}
