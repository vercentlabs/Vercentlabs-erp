// Browser-side JSON request for the app's own API routes. Throws the
// server's safe message on any non-2xx or `ok: false` response, so TanStack
// Query surfaces it through onError instead of treating a 403 as success.
export class RequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "RequestError";
  }
}

export type JsonRequestInit = RequestInit & { json?: unknown };

// What the app's API routes send back; only the fields read here are typed.
export type JsonPayload = {
  ok?: unknown;
  message?: string;
  code?: string;
  [key: string]: unknown;
};

// A `json` value becomes the JSON body with a JSON Content-Type (caller
// headers still win); without it the init is passed through untouched.
export function jsonRequestInit(init?: JsonRequestInit): RequestInit {
  const { json, ...rest } = init ?? {};
  return json === undefined
    ? rest
    : {
        ...rest,
        headers: { "Content-Type": "application/json", ...rest.headers },
        body: JSON.stringify(json),
      };
}

// The one JSON response contract of the app's API routes: an unreadable body
// counts as `{}`, and a non-2xx status or `ok: false` is a failure turned
// into an error by `toError` (which sees the decoded payload and the status).
export async function readJsonResponse<T>(
  response: Response,
  toError: (payload: JsonPayload, status: number) => Error,
): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false)
    throw toError(payload ?? {}, response.status);
  return payload as T;
}

export async function requestJson<T>(
  url: string,
  init?: JsonRequestInit,
  fallbackMessage = "Something went wrong.",
): Promise<T> {
  const response = await fetch(url, jsonRequestInit(init));
  return readJsonResponse<T>(
    response,
    (payload, status) =>
      new RequestError(
        payload.message || fallbackMessage,
        status,
        payload.code,
      ),
  );
}
