// Input normalization and validation for the contact record. Only a first
// name and one way to reach the person (an email, phone or mobile) are
// required; the company is optional, because you sometimes meet a person
// before you know their organization.
import { CrmError } from "../data-management/errors.js";
import { CONTACT_ROLES, MARKETING_CONSENT, PREFERRED_CONTACT_METHODS } from "./constants.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES = new Set(CONTACT_ROLES.map((entry) => entry.code));
const METHODS = new Set(PREFERRED_CONTACT_METHODS.map((entry) => entry.code));
const CONSENT = new Set(MARKETING_CONSENT.map((entry) => entry.code));

// camelCase field -> [column, maximum length]
const TEXT_FIELDS = Object.freeze({
  firstName: ["first_name", 120],
  middleName: ["middle_name", 120],
  lastName: ["last_name", 120],
  displayName: ["display_name", 240],
  email: ["email", 320],
  secondaryEmail: ["secondary_email", 320],
  phone: ["phone", 30],
  mobile: ["mobile", 30],
  alternatePhone: ["alternate_phone", 30],
  description: ["description", 10000],
  addressLine1: ["address_line1", 240],
  addressLine2: ["address_line2", 240],
  city: ["city", 120],
  state: ["state", 120],
  postalCode: ["postal_code", 20],
});

// Fields stored on the contact row itself. Job title, department, role and
// decision maker belong to the company relationship when the contact has a
// primary company (see records.js).
export const CONTACT_WRITABLE_COLUMNS = Object.freeze({
  ...Object.fromEntries(Object.entries(TEXT_FIELDS).map(([field, [column]]) => [field, column])),
  preferredContactMethod: "preferred_contact_method",
  sourceId: "source_id",
  countryCode: "country_code",
  doNotEmail: "do_not_email",
  doNotCall: "do_not_call",
  doNotSms: "do_not_sms",
  marketingConsent: "marketing_consent",
  useAccountAddress: "use_account_address",
});

// Fields that describe the person's position at their primary company.
export const ROLE_FIELDS = Object.freeze({ jobTitle: ["designation", "job_title", 160], department: ["department", "department", 160], role: ["contact_role", "role"], isDecisionMaker: ["is_decision_maker", "is_decision_maker"] });

const GOVERNED_FIELDS = Object.freeze({
  status: "Use Deactivate, Reactivate or Archive to change the status.",
  ownerUserId: "Use Assign to change the owner.",
  teamId: "Use Assign to change the team.",
  accountId: "Use Change company to link the contact to an account.",
  partyId: "Use Change company to link the contact to an account.",
  isPrimary: "Use Make primary contact on the account.",
  contactNumber: "The contact number is generated automatically.",
});

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const text = (value) => String(value ?? "").trim();

export function isUuid(value) {
  return UUID_PATTERN.test(String(value ?? ""));
}

export function requireUuid(value, label) {
  if (!isUuid(value)) throw new CrmError(400, `${label} is not valid.`, "CRM_CONTACT_VALIDATION");
  return String(value);
}

function usablePhone(value) {
  const digits = text(value).replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

export function composeDisplayName({ firstName, middleName, lastName }) {
  return [firstName, middleName, lastName].map(text).filter(Boolean).join(" ");
}

// Returns only the fields present in `input`, trimmed and typed.
// options.allowGoverned: the caller (create) handles owner/team/account itself.
export function normalizeContactInput(input = {}, { allowGoverned = false } = {}) {
  if (!allowGoverned)
    for (const [field, message] of Object.entries(GOVERNED_FIELDS))
      if (has(input, field)) throw new CrmError(409, message, "CRM_CONTACT_FIELD_GOVERNED");
  const normalized = {};
  for (const field of Object.keys(TEXT_FIELDS)) if (has(input, field)) normalized[field] = text(input[field]) || null;
  for (const field of ["email", "secondaryEmail"]) if (normalized[field]) normalized[field] = normalized[field].toLowerCase();
  for (const field of ["preferredContactMethod", "sourceId", "marketingConsent"]) if (has(input, field)) normalized[field] = text(input[field]).toLowerCase() || null;
  if (has(input, "sourceId")) normalized.sourceId = text(input.sourceId) || null;
  if (has(input, "countryCode")) normalized.countryCode = text(input.countryCode).toUpperCase() || null;
  for (const field of ["doNotEmail", "doNotCall", "doNotSms", "useAccountAddress"]) if (has(input, field)) normalized[field] = input[field] === true || input[field] === "true";
  if (normalized.marketingConsent === null) normalized.marketingConsent = "unknown";
  // Role fields (job title accepted under its old name, designation, too).
  if (has(input, "jobTitle") || has(input, "designation")) normalized.jobTitle = text(input.jobTitle ?? input.designation).slice(0, 160) || null;
  if (has(input, "department")) normalized.department = text(input.department).slice(0, 160) || null;
  if (has(input, "role")) normalized.role = text(input.role).toLowerCase() || null;
  if (has(input, "isDecisionMaker")) normalized.isDecisionMaker = input.isDecisionMaker === true || input.isDecisionMaker === "true";
  return normalized;
}

export function validateContact(normalized, existing = {}) {
  const candidate = { ...existing, ...normalized };
  const issues = [];
  const issue = (field, message) => issues.push({ field, message });
  if (!text(candidate.firstName)) issue("firstName", "Enter the first name.");
  if (!text(candidate.email) && !text(candidate.mobile) && !text(candidate.phone))
    issue("email", "Add a work email, mobile or work phone so the person can be reached.");
  for (const [field, [, maximum]] of Object.entries(TEXT_FIELDS))
    if (text(normalized[field]).length > maximum) issue(field, `Must be ${maximum} characters or fewer.`);
  for (const field of ["email", "secondaryEmail"])
    if (normalized[field] && !EMAIL_PATTERN.test(normalized[field])) issue(field, "Enter a valid email address.");
  if (normalized.email && normalized.secondaryEmail && normalized.email === normalized.secondaryEmail) issue("secondaryEmail", "The secondary email is the same as the work email.");
  for (const field of ["phone", "mobile", "alternatePhone"])
    if (normalized[field] && !usablePhone(normalized[field])) issue(field, "Enter a phone number with 7 to 15 digits.");
  if (normalized.preferredContactMethod && !METHODS.has(normalized.preferredContactMethod)) issue("preferredContactMethod", "Choose a preferred contact method.");
  if (normalized.role && !ROLES.has(normalized.role)) issue("role", "Choose a contact role.");
  if (normalized.marketingConsent && !CONSENT.has(normalized.marketingConsent)) issue("marketingConsent", "Choose a marketing preference.");
  if (normalized.sourceId && !isUuid(normalized.sourceId)) issue("sourceId", "Choose a source.");
  if (normalized.countryCode && !/^[A-Z]{2}$/.test(normalized.countryCode)) issue("countryCode", "Choose a country.");
  return issues;
}

export function assertValidContact(normalized, existing) {
  const issues = validateContact(normalized, existing);
  if (issues.length) throw new CrmError(400, issues[0].message, "CRM_CONTACT_VALIDATION", { issues });
}
