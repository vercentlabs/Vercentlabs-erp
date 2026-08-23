import { currentContext } from "./context.js";
import { redact } from "./redaction.js";

export function createLogger(service, sink = console) {
  if (!service || typeof service !== "string") {
    throw new TypeError("Logger service name is required.");
  }

  function write(level, message, fields = {}) {
    const record = {
      timestamp: new Date().toISOString(),
      level,
      service,
      message: String(message),
      ...currentContext(),
      ...redact(fields),
    };

    const output = JSON.stringify(record);
    const method =
      level === "error" ? "error" : level === "warn" ? "warn" : "log";

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
