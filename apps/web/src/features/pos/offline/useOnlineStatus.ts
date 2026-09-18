"use client";

import { useEffect, useState } from "react";

// F297 — explicit online/offline detection + UI indicator. navigator.onLine
// alone is known to be optimistic (it can report "online" while a captive
// portal or a flaky link makes real requests fail), so this listens for
// the browser's own online/offline events, which is the same signal
// Playwright's context.setOffline(true/false) drives in the E2E spec
// (apps/web/e2e/pos-offline-sync.spec.ts) -- a real, testable mechanism
// rather than a periodic network probe.
export function useOnlineStatus(): boolean {
  // `typeof navigator === "undefined"` used to be a reliable "we're on the
  // server" check, but Node.js 21+ defines a partial, non-functional global
  // `navigator` (no real `onLine`), so `navigator.onLine` reads as
  // `undefined` (falsy) during SSR -- silently rendering the offline
  // checkout panel server-side and causing a real hydration mismatch
  // against the client's genuine online state. `window` is never defined
  // in Node.js, so it's the safe check.
  const [online, setOnline] = useState(() => (typeof window === "undefined" ? true : navigator.onLine));

  useEffect(() => {
    function handleOnline() {
      setOnline(true);
    }
    function handleOffline() {
      setOnline(false);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return online;
}
