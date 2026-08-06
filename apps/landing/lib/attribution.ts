/**
 * First-touch campaign attribution. Uses first-party localStorage (not a
 * third-party tracking cookie) — same-origin storage of UTM parameters and
 * referrer category is standard, low-risk first-party analytics, not the kind
 * of cross-site tracking a consent banner exists to gate. No personal data is
 * ever stored here — only campaign metadata and timestamps.
 */

const STORAGE_KEY = "vercentlabs_attribution_v1";

export interface AttributionRecord {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  landingPath: string;
  referrerCategory: "direct" | "search" | "social" | "referral" | "email";
  firstTouchAt: string;
}

function classifyReferrer(referrer: string): AttributionRecord["referrerCategory"] {
  if (!referrer) return "direct";
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "");
    if (/(^|\.)google\.|bing\.com|duckduckgo\.com|yahoo\./.test(host)) return "search";
    if (/(^|\.)linkedin\.com|twitter\.com|x\.com|facebook\.com|instagram\.com/.test(host)) return "social";
    if (host === window.location.hostname) return "direct";
    return "referral";
  } catch {
    return "direct";
  }
}

/** Call once on app load. Never overwrites an existing first-touch record. */
export function captureFirstTouchAttribution(): AttributionRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return JSON.parse(existing) as AttributionRecord;

    const params = new URLSearchParams(window.location.search);
    const record: AttributionRecord = {
      landingPath: window.location.pathname,
      referrerCategory: classifyReferrer(document.referrer),
      firstTouchAt: new Date().toISOString(),
      utmSource: params.get("utm_source")?.slice(0, 200) || undefined,
      utmMedium: params.get("utm_medium")?.slice(0, 200) || undefined,
      utmCampaign: params.get("utm_campaign")?.slice(0, 200) || undefined,
      utmContent: params.get("utm_content")?.slice(0, 200) || undefined,
      utmTerm: params.get("utm_term")?.slice(0, 200) || undefined,
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    return record;
  } catch {
    return null;
  }
}

export function getAttribution(): AttributionRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AttributionRecord) : null;
  } catch {
    return null;
  }
}
