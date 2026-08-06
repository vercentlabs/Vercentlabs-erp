"use client";

import { useEffect } from "react";
import { captureFirstTouchAttribution } from "@/lib/attribution";

/**
 * Mounted once in the root layout (every page, not just the homepage) —
 * captures first-touch attribution silently. Does not fire any analytics
 * event itself; see components/analytics/homepage-view-tracker.tsx for the
 * homepage-specific `homepage_view` event.
 */
export function AttributionInit() {
  useEffect(() => {
    captureFirstTouchAttribution();
  }, []);

  return null;
}
