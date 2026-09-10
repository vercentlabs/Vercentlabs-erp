// F005 Lead assignment — shared error class and primitives. Moved here
// (from the legacy flat lead-governance.js) as part of CRM vNext Prompt 4;
// lead-governance.js now imports this class back for its own (non-F005)
// Lead-configuration functions so both halves keep throwing the same
// error shape without a circular module dependency.
export class LeadGovernanceError extends Error {
  constructor(status, message, code = "CRM_LEAD_GOVERNANCE_ERROR", details = []) {
    super(message);
    this.name = "LeadGovernanceError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const text = (v) => String(v ?? "").trim();
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Also used by lead-governance.js's own (non-F005) layout validation-rule
// matching — kept here as the one shared definition rather than duplicated.
export function matches(criteria, input) {
  return Object.entries(criteria || {}).every(([k, v]) =>
    Array.isArray(v)
      ? v.map(String).includes(String(input[k] ?? ""))
      : String(input[k] ?? "") === String(v),
  );
}
