/**
 * Provider-neutral, structured lead-delivery observability (Phase 7,
 * Workstream 13 — "the single highest-severity risk on this entire list").
 * No monitoring backend (Sentry/Datadog/CloudWatch) is provisioned in this
 * repo — this emits one structured, single-line JSON log per outcome,
 * parseable by any of those later without code changes here. Never logs the
 * submitted name/email/phone/company — only operational metadata, matching
 * the existing safe-logging convention already used in
 * app/api/book-demo/route.ts before this file existed.
 */

export type LeadCaptureOutcome = "success" | "validation_failure" | "upstream_failure" | "timeout";

interface LeadCaptureLogEntry {
  event: `lead_capture_${LeadCaptureOutcome}`;
  requestId: string;
  route: string;
  durationMs: number;
  timestamp: string;
  statusCode?: number;
}

export function logLeadCaptureEvent(outcome: LeadCaptureOutcome, requestId: string, durationMs: number, statusCode?: number): void {
  const entry: LeadCaptureLogEntry = {
    event: `lead_capture_${outcome}`,
    requestId,
    route: "/api/book-demo",
    durationMs: Math.round(durationMs),
    timestamp: new Date().toISOString(),
    ...(statusCode !== undefined ? { statusCode } : {}),
  };
  const line = JSON.stringify(entry);
  if (outcome === "success") {
    console.log(line);
  } else {
    console.error(line);
  }
}

/** AbortSignal.timeout() throws a DOMException named "TimeoutError" — distinct from a user/network abort or any other thrown error. */
export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}
