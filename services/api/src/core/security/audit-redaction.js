// redactAuditPayload() runs on every metadata/before/after payload the
// audit() function persists. Conservative by design — a denylist of
// key-name patterns that commonly carry secrets — so audit_events never
// receives sensitive fields verbatim.
const SENSITIVE_KEY_PATTERN =
  /password|secret|token|credential|api[-_]?key|authorization|private[-_]?key|encrypted|access[-_]?token|refresh[-_]?token|client[-_]?secret/i;

const REDACTED = "[redacted]";

export function redactAuditPayload(value, depth = 0) {
  if (depth > 6 || value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redactAuditPayload(item, depth + 1));
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = REDACTED;
      continue;
    }
    result[key] = entry !== null && typeof entry === "object" ? redactAuditPayload(entry, depth + 1) : entry;
  }
  return result;
}
