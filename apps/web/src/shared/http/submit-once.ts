"use client";

// One submission, however many clicks. A create form keeps one key for as
// long as it is open (useSubmitKey) and runs its save through submitOnce: the
// app's POSTs to /api made while that save runs carry the key as an
// Idempotency-Key header, and the server (core/workspace-route.ts) answers a
// repeat of the same key and body with the first result instead of creating
// a second record. The key is namespaced on the server by the request path,
// so it can never be confused with another endpoint's.
import { useCallback, useRef } from "react";

let activeKey: string | null = null;
let installed = false;

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const key = activeKey;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    if (!key || method !== "POST" || url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return original(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has("Idempotency-Key")) headers.set("Idempotency-Key", key);
    return original(input, { ...init, headers });
  };
}

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export async function submitOnce<T>(key: string, run: () => Promise<T>): Promise<T> {
  install();
  activeKey = key;
  try {
    return await run();
  } finally {
    if (activeKey === key) activeKey = null;
  }
}

// The key a form submits with. Every click until a save succeeds uses the
// same key, so a repeat (a second click, a retry after a lost answer) returns
// the first result. Once a save succeeds the key is replaced, so a form or
// dialog that stays open for another record never reuses it. Forms that open
// the new record keep their button busy after success (isPending || isSuccess)
// so nothing can be clicked while the next page loads.
export function useSubmitKey() {
  const key = useRef<string | null>(null);
  const run = useCallback(async <T,>(work: () => Promise<T>) => {
    const used = (key.current ??= newKey());
    const result = await submitOnce(used, work);
    if (key.current === used) key.current = newKey();
    return result;
  }, []);
  return { run };
}
