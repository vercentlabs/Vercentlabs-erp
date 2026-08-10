// Prompt 9 (Governance Foundation), Parts 13/42/43. Audit payloads
// (metadata/before_data/after_data) are hand-curated by ~89 call sites
// across the app — audit() itself performs no redaction (confirmed by
// direct inspection), so there is no structural guarantee against a
// future field leaking through. This wraps the existing (but previously
// unused for this purpose) packages/observability redact() — which
// already catches password/token/secret/API-key/credential/session/
// authorization/cookie-shaped keys — with one additional pattern for the
// banking/PII-shaped keys HR & Payroll and Procurement already protect on
// the read path (services/api/src/field-visibility.js), so the same
// classes of value can never resurface through an audit payload either.
// Applied identically before both on-screen display and CSV export
// (Part 43 — export must never be a redaction bypass).
import { redact as redactSecrets } from "@vercentlabs/observability";

const SENSITIVE_KEY_PATTERN =
  /(bank[-_]?(account|name|branch|ifsc|swift|routing)|iban|routing[-_]?number|account[-_]?number|tax[-_]?identifier|statutory[-_]?identifier|date[-_]?of[-_]?birth|personal[-_]?(email|phone)|emergency[-_]?contact|ssn|passport|aadhaar|pan[-_]?number|gstin|private[-_]?note)/i;

const MAX_DEPTH = 5;
const MAX_ENTRIES = 100;
const MAX_STRING_LENGTH = 2_000;

function redactSensitiveKeys(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[TRUNCATED]";
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ENTRIES).map((entry) => redactSensitiveKeys(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_ENTRIES)
        .map(([key, entry]) => [
          key,
          SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redactSensitiveKeys(entry, depth + 1),
        ]),
    );
  }
  if (typeof value === "string" && value.length > MAX_STRING_LENGTH) {
    return `${value.slice(0, MAX_STRING_LENGTH)}…`;
  }
  return value;
}

export function redactAuditPayload(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  return redactSensitiveKeys(redactSecrets(value));
}
