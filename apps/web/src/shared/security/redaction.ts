
const SENSITIVE_KEY =
  /(?:password|passphrase|passcode|secret|token|authorization|cookie|session|api[_-]?key|client[_-]?secret|private[_-]?key|otp|totp|recovery[_-]?code|cvv|cvc|bank[_-]?(?:account|number)|account[_-]?number|aadhaar|aadhar|ssn)/i;

const MAX_DEPTH = 12;
const MAX_ARRAY = 500;
const MAX_OBJECT_KEYS = 500;

function redactValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (depth > MAX_DEPTH) return "[MAX_DEPTH]";

  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "string") {
    return value.length > 10_000
      ? `${value.slice(0, 10_000)}[TRUNCATED]`
      : value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY)
      .map((item) => redactValue(item, depth + 1, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);

    const result: Record<string, unknown> = {};

    for (
      const [key, current] of Object.entries(
        value as Record<string, unknown>,
      ).slice(0, MAX_OBJECT_KEYS)
    ) {
      result[key] = SENSITIVE_KEY.test(key)
        ? "[REDACTED]"
        : redactValue(current, depth + 1, seen);
    }

    return result;
  }

  return String(value);
}

export function redactAuditPayload(value: unknown): unknown {
  return redactValue(value, 0, new WeakSet<object>());
}
