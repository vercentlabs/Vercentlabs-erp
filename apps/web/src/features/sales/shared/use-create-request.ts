"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// A record page opened with ?create=<kind> (from the Sales "+ Create" menu)
// hands that request to the page once its record has loaded, then drops it
// from the address so a refresh does not open the dialog again. The page
// decides whether the action is available on this record.
export function useCreateRequest(ready: boolean, onRequest: (kind: string) => void) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const kind = params.get("create");
  const handled = useRef(false);
  const request = useRef(onRequest);
  useEffect(() => { request.current = onRequest; });
  useEffect(() => {
    if (!ready || !kind || handled.current) return;
    handled.current = true;
    request.current(kind);
    router.replace(pathname);
  }, [ready, kind, pathname, router]);
}
