"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { track } from "@/lib/analytics";

/**
 * No visible output — the confirmation heading/text render server-side in
 * page.tsx so they're never gated behind client hydration (a real bug this
 * phase: a fallback={null} Suspense boundary around the *visible* content
 * left the page looking blank for a moment on load — see decision-log.md).
 * This component only handles requestId-dependent side effects: moving
 * focus to the heading, and firing product_demo_complete exactly once per
 * request id even across a page refresh.
 */
export function ThankYouEffects() {
  const searchParams = useSearchParams();
  const requestId = searchParams.get("rid");

  useEffect(() => {
    document.getElementById("thank-you-heading")?.focus({ preventScroll: true });

    if (!requestId) return;
    try {
      const key = `demo_thankyou_fired_${requestId}`;
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
      track("product_demo_complete");
    } catch {
      // sessionStorage can throw in locked-down environments — never block rendering on it.
    }
  }, [requestId]);

  return null;
}
