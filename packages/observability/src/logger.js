import { currentContext } from "./context.js";
import { redact } from "./redaction.js";

// Cloud Logging reads `severity`, `message` and `timestamp` from a JSON line
// on stdout/stderr; the rest lands in jsonPayload. `event` is the stable,
// low-cardinality name log-based metrics and alerts count
// (infrastructure/terraform/monitoring.tf). Error-severity records that carry
// a stack are marked as Error Reporting events.
const SEVERITY = Object.freeze({ debug: "DEBUG", info: "INFO", warn: "WARNING", error: "ERROR" });
const ERROR_EVENT_TYPE = "type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent";

function deployment(environment = process.env) {
  return {
    environment: environment.DEPLOYMENT_ENVIRONMENT || environment.NODE_ENV || undefined,
    release: environment.RELEASE_SHA || undefined,
  };
}

export function createLogger(service, sink = console) {
  if (!service || typeof service !== "string") {
    throw new TypeError("Logger service name is required.");
  }

  function write(level, message, fields = {}) {
    const { environment, release } = deployment();
    const safe = redact(fields);
    const record = {
      timestamp: new Date().toISOString(),
      severity: SEVERITY[level],
      level,
      service,
      ...(environment ? { environment } : {}),
      ...(release ? { release } : {}),
      message: String(message),
      ...currentContext(),
      ...safe,
    };
    if (level === "error" && typeof safe?.stack_trace === "string") {
      record["@type"] = ERROR_EVENT_TYPE;
      record.serviceContext = { service, ...(release ? { version: release } : {}) };
    }

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
    /** A named, countable event: `event` is the metric/alert key. */
    event: (name, fields = {}, level = "info") => write(level, name, { event: name, ...fields }),
  });
}
