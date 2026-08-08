"use client";

import { useEffect } from "react";
import { initWebVitals } from "@/lib/web-vitals";

/** No visible output — mounts the Web Vitals collector once per page load. See lib/web-vitals.ts. */
export function WebVitalsReporter() {
  useEffect(() => {
    initWebVitals();
  }, []);

  return null;
}
