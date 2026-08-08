import { onCLS, onINP, onLCP, type Metric } from "web-vitals";
import { track, type AnalyticsEventName } from "./analytics";

/**
 * Real User Monitoring (RUM) foundation — Phase 7. Collects only LCP, INP,
 * and CLS (the 3 Core Web Vitals with documented field targets), routed
 * through the same track() entry point every other event uses. No new
 * analytics provider or storage backend is wired: with none configured,
 * track() forwards to an optional window sink and a dev console log, same
 * as every other event today. This means field data will show "0 events
 * collected" until a real provider is wired and this site has real
 * production traffic — that's stated honestly in
 * docs/landing-redesign/phase-7/core-web-vitals-audit.md, not hidden.
 *
 * Deliberately NOT collected: FCP, TTFB (both optional per the governing
 * brief) — Lighthouse's lab runs already cover both, and adding 2 more
 * event types for marginal RUM value against zero current traffic wasn't
 * judged worth the taxonomy growth this phase. Revisit once real traffic
 * and a real provider exist.
 */

const EVENT_BY_METRIC_NAME: Partial<Record<Metric["name"], AnalyticsEventName>> = {
  LCP: "web_vitals_lcp",
  INP: "web_vitals_inp",
  CLS: "web_vitals_cls",
};

/**
 * Buckets a real pathname into a route *pattern* — never the literal path —
 * so a dynamic segment (a module key, a glossary term, a request id in a
 * query string) never becomes an analytics dimension. Query strings are
 * never read here at all.
 */
export function normalizeRoutePattern(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "/";
  const [first, second, third] = segments;

  const singleDynamicSegmentRoots = new Set(["modules", "industries", "solutions", "workflows", "compare"]);
  if (singleDynamicSegmentRoots.has(first) && second) {
    return `/${first}/[slug]`;
  }

  if (first === "resources") {
    if (second === "glossary" && third) return "/resources/glossary/[slug]";
    if (second === "glossary") return "/resources/glossary";
    if (second === "feed.xml") return "/resources/feed.xml";
    if (second) return "/resources/[slug]";
  }

  return pathname;
}

/** LCP/INP report in milliseconds (whole-number precision is standard); CLS is a unitless score, typically 0-1, where whole-number rounding would destroy all signal. */
function roundMetricValue(metric: Metric): number {
  if (metric.name === "CLS") return Math.round(metric.value * 1000) / 1000;
  return Math.round(metric.value);
}

function report(metric: Metric): void {
  const eventName = EVENT_BY_METRIC_NAME[metric.name];
  if (!eventName) return;
  track(eventName, {
    routePattern: normalizeRoutePattern(window.location.pathname),
    metricValue: roundMetricValue(metric),
    metricRating: metric.rating,
    navigationType: metric.navigationType,
  });
}

/** Call once on app mount (see components/analytics/web-vitals-reporter.tsx). */
export function initWebVitals(): void {
  if (typeof window === "undefined") return;
  onLCP(report);
  onINP(report);
  onCLS(report);
}
