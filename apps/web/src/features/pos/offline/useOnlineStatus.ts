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
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));

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
