"use client";

// A read that never answers must end. Without this, a stalled request left screens on "Loading..." forever. Every
// same-origin GET under /api gets a 30 second ceiling (unless the caller supplied its own signal); the failure
// surfaces as an ordinary rejected query, which every list turns into a retryable error state.
const READ_TIMEOUT_MS = 30_000;
let installed = false;

export function installReadTimeout() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const isApiRead = method === "GET" && (url.startsWith("/api/") || url.includes(`${window.location.origin}/api/`));
    if (!isApiRead || init?.signal) return original(input, init);
    return original(input, { ...init, signal: AbortSignal.timeout(READ_TIMEOUT_MS) }).catch((error: unknown) => {
      if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new Error("The request took too long. Check your connection and try again.");
      }
      throw error;
    });
  };
}
