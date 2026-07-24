type JsonRecord = Record<string, unknown>;

export type ClientResult<T extends object = JsonRecord> = T & {
  ok: boolean;
  message?: string;
  status?: number;
};

export async function requestJson<T extends object = JsonRecord>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: { timeoutMs?: number } = {},
): Promise<ClientResult<T>> {
  const controller = new AbortController();
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 15_000);
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const suppliedSignal = init?.signal;
  const abortFromCaller = () => controller.abort();

  if (suppliedSignal) {
    if (suppliedSignal.aborted) controller.abort();
    else suppliedSignal.addEventListener("abort", abortFromCaller, { once: true });
  }

  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const text = await response.text();
    let payload: JsonRecord = {};

    if (text) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          payload = parsed as JsonRecord;
        }
      } catch {
        payload = {};
      }
    }

    const message =
      typeof payload.message === "string"
        ? payload.message
        : response.ok
          ? undefined
          : response.status === 401
            ? "Your session has expired. Sign in and try again."
            : `Request failed with status ${response.status}.`;

    return {
      ...payload,
      ok: response.ok && payload.ok !== false,
      status: response.status,
      ...(message ? { message } : {}),
    } as ClientResult<T>;
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message:
        error instanceof DOMException && error.name === "AbortError"
          ? "The request timed out. Check your connection and try again."
          : "The server could not be reached. Check your connection and try again.",
    } as ClientResult<T>;
  } finally {
    window.clearTimeout(timer);
    suppliedSignal?.removeEventListener("abort", abortFromCaller);
  }
}
