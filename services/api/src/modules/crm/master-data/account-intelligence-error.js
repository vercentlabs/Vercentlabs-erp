// The one error type of the Account/Contact hierarchy, merge, Customer 360
// and privacy services (status + code), and the identifier check that raises it.

const text = (value) => String(value ?? "").trim();

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CrmAccountIntelligenceError extends Error {
  constructor(status, message, code = "CRM_ACCOUNT_INTELLIGENCE_ERROR") {
    super(message);
    this.name = "CrmAccountIntelligenceError";
    this.status = status;
    this.code = code;
  }
}

export function assertId(value, label) {
  if (!UUID.test(text(value))) {
    throw new CrmAccountIntelligenceError(
      400,
      `${label} is invalid.`,
      "CRM_IDENTIFIER_INVALID",
    );
  }
  return text(value);
}
