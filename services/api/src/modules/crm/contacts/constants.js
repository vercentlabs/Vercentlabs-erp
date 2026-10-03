// The fixed vocabulary of a contact. Status answers "is the record in use?";
// role answers "who is this person in the buying process?". Qualification
// belongs to leads and opportunities, not to the contact.
export const CONTACT_STATUSES = Object.freeze([
  { code: "active", label: "Active" },
  { code: "inactive", label: "Inactive" },
  { code: "archived", label: "Archived" },
]);

export const CONTACT_ROLES = Object.freeze([
  { code: "decision_maker", label: "Decision Maker" },
  { code: "influencer", label: "Influencer" },
  { code: "champion", label: "Champion" },
  { code: "procurement", label: "Procurement" },
  { code: "finance", label: "Finance" },
  { code: "technical", label: "Technical" },
  { code: "operations", label: "Operations" },
  { code: "user", label: "User" },
  { code: "executive", label: "Executive" },
  { code: "billing", label: "Billing Contact" },
  { code: "shipping", label: "Shipping Contact" },
  { code: "support", label: "Support Contact" },
  { code: "other", label: "Other" },
]);

export const PREFERRED_CONTACT_METHODS = Object.freeze([
  { code: "email", label: "Email" },
  { code: "phone", label: "Phone" },
  { code: "mobile", label: "Mobile" },
  { code: "other", label: "Other" },
]);

export const MARKETING_CONSENT = Object.freeze([
  { code: "unknown", label: "Not asked" },
  { code: "opted_in", label: "Opted in" },
  { code: "opted_out", label: "Opted out" },
]);

export const CONTACT_ACTIVITY_TYPES = Object.freeze([
  { code: "call", label: "Call" },
  { code: "email", label: "Email" },
  { code: "meeting", label: "Meeting" },
  { code: "other", label: "General activity" },
]);

export const CONTACT_FOLLOW_UP_TYPES = Object.freeze(["call", "email", "meeting", "task", "other"]);

export const CONTACT_PERMISSIONS = Object.freeze({
  view: "crm.contacts.view",
  viewAll: "crm.contacts.view_all",
  viewSensitive: "crm.contacts.view_sensitive",
  create: "crm.contacts.create",
  edit: "crm.contacts.edit",
  archive: "crm.contacts.archive",
  delete: "crm.contacts.delete",
  assign: "crm.contacts.assign",
  reassign: "crm.contacts.reassign",
  merge: "crm.contacts.merge",
  import: "crm.contacts.import",
  export: "crm.contacts.export",
});

export const CONTACT_NUMBER_DOCUMENT_TYPE = "crm_contact";

const labels = (list) => new Map(list.map((entry) => [entry.code, entry.label]));
const STATUS_LABELS = labels(CONTACT_STATUSES);
const ROLE_LABELS = labels(CONTACT_ROLES);
export const contactStatusLabel = (code) => STATUS_LABELS.get(code) ?? code;
export const contactRoleLabel = (code) => ROLE_LABELS.get(code) ?? code;
