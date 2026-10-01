// The one error type of the CRM communications and meeting-booking services
// (status + code), and the identifier check that raises it.

const text = (value) => String(value ?? "").trim();

// Same one-line check every other CRM domain module in this codebase
// already carries locally (index.js's recordScope, timeline.js, task-
// operations.js) — trivial enough that a shared import would be more
// indirection than the duplication it avoids.

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CrmCommunicationsError extends Error {
  constructor(status, message, code = "CRM_COMMUNICATIONS_ERROR") {
    super(message);
    this.name = "CrmCommunicationsError";
    this.status = status;
    this.code = code;
  }
}

export function assertId(value, label) {
  const result = text(value);
  if (!UUID.test(result)) {
    throw new CrmCommunicationsError(
      400,
      `${label} is invalid.`,
      "CRM_IDENTIFIER_INVALID",
    );
  }
  return result;
}
