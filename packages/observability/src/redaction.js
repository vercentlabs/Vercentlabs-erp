const SECRET_PATTERN =
  /(authorization|cookie|password|secret|token|api[-_]?key|credential|session)/i;

export function redact(value, depth = 0) {
  if (depth > 5) return "[TRUNCATED]";
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      code: value.code,
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => redact(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 100)
        .map(([key, entry]) => [
          key,
          SECRET_PATTERN.test(key) ? "[REDACTED]" : redact(entry, depth + 1),
        ]),
    );
  }
  if (typeof value === "string" && value.length > 2_000) {
    return `${value.slice(0, 2_000)}...`;
  }
  return value;
}
