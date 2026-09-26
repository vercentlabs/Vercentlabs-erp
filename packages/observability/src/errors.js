import { redact } from "./redaction.js";

export function normalizeError(error) {
  if (error instanceof Error) {
    return Object.freeze({
      name: error.name || "Error",
      message: error.message || "Unexpected error.",
      code: error.code,
      stack:
        process.env.NODE_ENV === "production"
          ? undefined
          : String(error.stack || "").slice(0, 12_000) || undefined,
    });
  }

  return Object.freeze({
    name: "NonErrorThrown",
    message: String(error),
  });
}

export function reportError(logger, error, fields = {}) {
  if (!logger || typeof logger.error !== "function") {
    throw new TypeError("reportError requires a logger.");
  }

  const normalized = normalizeError(error);
  // Error Reporting groups by stack trace; the stack names code locations
  // only (never request data), so it is kept in production too.
  const stack = error instanceof Error && error.stack ? String(error.stack).slice(0, 12_000) : undefined;
  logger.error(normalized.message, {
    ...redact(fields),
    error: normalized,
    ...(stack ? { stack_trace: stack } : {}),
  });

  return normalized;
}
