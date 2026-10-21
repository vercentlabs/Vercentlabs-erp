"use client";

// Remembers the app someone is in, so signing in later returns them to it.
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { moduleKeyForPath } from "@/shell/navigation/app-landing";

export function RememberLastApp() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);
  useEffect(() => {
    const moduleKey = moduleKeyForPath(pathname);
    if (!moduleKey || moduleKey === last.current) return;
    last.current = moduleKey;
    void fetch("/api/workspace/last-app", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ moduleKey }) }).catch(() => undefined);
  }, [pathname]);
  return null;
}
