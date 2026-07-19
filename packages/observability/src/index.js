import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

const contextStorage = new AsyncLocalStorage();
const SECRET_PATTERN = /(authorization|cookie|password|secret|token|api[-_]?key|credential|session)/i;

function safeValue(value, depth = 0) {
  if (depth > 5) return "[TRUNCATED]";
  if (value instanceof Error) return { name: value.name, message: value.message, code: value.code };
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => safeValue(entry, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, entry]) => [key, SECRET_PATTERN.test(key) ? "[REDACTED]" : safeValue(entry, depth + 1)]));
  }
  if (typeof value === "string" && value.length > 2_000) return `${value.slice(0, 2_000)}…`;
  return value;
}

export function redact(value) { return safeValue(value); }

export function currentContext() { return contextStorage.getStore() || {}; }

export function runWithContext(input, work) {
  const context = Object.freeze({ requestId: input.requestId || randomUUID(), correlationId: input.correlationId || input.requestId || randomUUID(), organizationId: input.organizationId || undefined, userId: input.userId || undefined });
  return contextStorage.run(context, work);
}

export function requestIdentifiers(headers) {
  const provided = headers?.get?.("x-request-id")?.trim();
  const correlation = headers?.get?.("x-correlation-id")?.trim();
  const valid = (value) => value && /^[A-Za-z0-9._:-]{8,128}$/.test(value);
  const requestId = valid(provided) ? provided : randomUUID();
  return Object.freeze({ requestId, correlationId: valid(correlation) ? correlation : requestId });
}

export function createLogger(service, sink = console) {
  function write(level, message, fields = {}) {
    const record = { timestamp: new Date().toISOString(), level, service, message: String(message), ...currentContext(), ...safeValue(fields) };
    const output = JSON.stringify(record);
    const method = level === "error" ? "error" : level === "warn" ? "warn" : "log";
    sink[method](output);
    return record;
  }
  return Object.freeze({
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  });
}
