import { ANALYTICS_EVENTS, type HomepageAnalyticsId } from "@vercentlabs/landing-content";

/**
 * Single analytics entry point (per docs/landing-redesign/phase-3/phase-4-brief.md's
 * predecessor instruction: "stub event dispatch behind one entry point so the
 * provider can be swapped later without touching every call site"). No analytics
 * provider is wired into this repository yet — track() currently only forwards to
 * an optional window-level sink (for a future provider script to attach to) and,
 * in development, the console. It never throws: analytics must never block a
 * conversion action like a form submission.
 */

export type AnalyticsEventName =
  | (typeof ANALYTICS_EVENTS)[number]
  | HomepageAnalyticsId
  | "implementation_specialist_cta_click"
  | "sticky_mobile_cta_click";

/**
 * Only non-identifying properties are accepted at the type level — never widen
 * this to accept free-form objects, or a future call site could accidentally
 * pass name/email/phone straight into an analytics payload.
 */
export interface SafeAnalyticsProperties {
  section?: string;
  ctaLocation?: string;
  ctaDestination?: string;
  module?: string;
  workflow?: string;
  industry?: string;
  formStep?: string;
  errorCategory?: string;
  campaignSource?: string;
  campaignMedium?: string;
  campaignName?: string;
  referrerCategory?: string;
}

declare global {
  interface Window {
    __vercentlabsAnalyticsSink?: (event: AnalyticsEventName, properties?: SafeAnalyticsProperties) => void;
  }
}

export function track(event: AnalyticsEventName, properties?: SafeAnalyticsProperties): void {
  try {
    if (typeof window === "undefined") return;
    if (process.env.NODE_ENV !== "production") {
      console.debug("[analytics]", event, properties ?? {});
    }
    window.__vercentlabsAnalyticsSink?.(event, properties);
  } catch {
    // Analytics must never throw into the caller — a broken sink should never
    // break the page or block a conversion action.
  }
}
