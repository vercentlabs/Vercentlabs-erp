// Data classes a retention policy can be recorded for, and what actually
// enforces each one. A retention policy row is a recorded decision; nothing
// is deleted just because a row exists. Only classes with a real, registered
// mechanism say so - and statutory records are never auto-deleted.
//
//   enforcement "review_required"   recorded; applying it is a reviewed action
//   enforcement "statutory_hold"    legal/tax/payroll evidence: never deleted
//                                   automatically, whatever the policy says
//   enforcement "automatic_expiry"  a platform mechanism removes it on expiry
export const PRIVACY_DATA_CLASSES = Object.freeze([
  Object.freeze({ key: "crm.personal_data", moduleKey: "crm", label: "CRM contact and lead personal data", enforcement: "review_required", note: "Apply through CRM Settings > Data requests (preview, then execute)." }),
  Object.freeze({ key: "crm.communications", moduleKey: "crm", label: "CRM emails, calls and meeting notes", enforcement: "review_required", note: "Recorded only; no automatic deletion." }),
  Object.freeze({ key: "support.tickets", moduleKey: "support", label: "Support tickets and customer messages", enforcement: "review_required", note: "Recorded only; no automatic deletion." }),
  Object.freeze({ key: "hr.employee_records", moduleKey: "hr-payroll", label: "Employee and payroll records", enforcement: "statutory_hold", note: "Statutory records: never deleted automatically." }),
  Object.freeze({ key: "accounting.financial_records", moduleKey: "accounting", label: "Accounting, tax and payment records", enforcement: "statutory_hold", note: "Statutory records: never deleted automatically." }),
  Object.freeze({ key: "platform.audit_events", moduleKey: null, label: "Audit history", enforcement: "statutory_hold", note: "Audit evidence is append-only and never deleted automatically." }),
  Object.freeze({ key: "platform.export_files", moduleKey: null, label: "Generated export files", enforcement: "automatic_expiry", note: "Export files expire automatically (Settings > Feature configuration: Keep export files for)." }),
]);

export function getPrivacyDataClass(key) {
  return PRIVACY_DATA_CLASSES.find((dataClass) => dataClass.key === key) ?? null;
}
