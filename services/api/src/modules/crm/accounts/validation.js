// Input normalization and validation for the account record. Only the
// company name is required: a salesperson can create "Acme Technologies" with
// a phone, an email and an owner and enrich the account later. Legal and tax
// identity is not asked for here; it belongs to the Customer Master.
import { CrmError } from "../data-management/errors.js";
import { ACCOUNT_TYPES, EMPLOYEE_RANGES } from "./constants.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = new Set(ACCOUNT_TYPES.map((entry) => entry.code));
const MAX_REVENUE = 1_000_000_000_000_000;

// camelCase field -> [column, maximum length]
const TEXT_FIELDS = Object.freeze({
  displayName: ["display_name", 240],
  legalName: ["legal_name", 240],
  industry: ["industry", 160],
  website: ["website", 500],
  email: ["email", 320],
  phone: ["phone", 30],
  secondaryPhone: ["secondary_phone", 30],
  description: ["description", 10000],
  sourceDetail: ["source_detail", 240],
});

// Fields the generic create/update accept. Owner, team, status, parent and
// the customer link change only through their own operations.
export const ACCOUNT_WRITABLE_COLUMNS = Object.freeze({
  ...Object.fromEntries(Object.entries(TEXT_FIELDS).map(([field, [column]]) => [field, column])),
  accountType: "account_type",
  employeeRange: "employee_range",
  annualRevenue: "annual_revenue",
  sourceId: "source_id",
  currencyCode: "currency_code",
});

const GOVERNED_FIELDS = Object.freeze({
  status: "Use Deactivate, Reactivate or Archive to change the status.",
  ownerUserId: "Use Assign to change the owner.",
  teamId: "Use Assign to change the team.",
  parentPartyId: "Use Set parent account to change the parent.",
  customerNumber: "The customer number is set by Create customer.",
  partyType: "The commercial role is set by Create customer.",
  code: "The account number is generated automatically.",
  gstin: "GST details belong to the Customer Master in Sales.",
  pan: "Tax identity belongs to the Customer Master in Sales.",
  paymentTermId: "Payment terms belong to the Customer Master in Sales.",
  creditLimit: "Credit settings belong to the Customer Master in Sales.",
});

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const text = (value) => String(value ?? "").trim();

export function isUuid(value) {
  return UUID_PATTERN.test(String(value ?? ""));
}

export function requireUuid(value, label) {
  if (!isUuid(value)) throw new CrmError(400, `${label} is not valid.`, "CRM_ACCOUNT_VALIDATION");
  return String(value);
}

function usablePhone(value) {
  const digits = text(value).replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

// "acme.example" becomes "https://acme.example"; the database stores websites
// with a scheme.
function normalizeWebsite(value) {
  const site = text(value);
  if (!site) return null;
  return /^https?:\/\//i.test(site) ? site : `https://${site}`;
}

// Returns only the fields present in `input`, trimmed and typed.
export function normalizeAccountInput(input = {}) {
  for (const [field, message] of Object.entries(GOVERNED_FIELDS))
    if (has(input, field)) throw new CrmError(409, message, "CRM_ACCOUNT_FIELD_GOVERNED");
  const normalized = {};
  for (const field of Object.keys(TEXT_FIELDS)) {
    if (has(input, field)) normalized[field] = text(input[field]) || null;
  }
  if (has(normalized, "email") && normalized.email) normalized.email = normalized.email.toLowerCase();
  if (has(normalized, "website")) normalized.website = normalizeWebsite(normalized.website);
  if (has(input, "accountType") && text(input.accountType)) normalized.accountType = text(input.accountType).toLowerCase();
  for (const field of ["employeeRange", "sourceId"]) {
    if (has(input, field)) normalized[field] = text(input[field]) || null;
  }
  if (has(input, "currencyCode")) normalized.currencyCode = text(input.currencyCode).toUpperCase() || null;
  if (has(input, "annualRevenue")) {
    const raw = text(input.annualRevenue).replace(/[,\s]/g, "");
    normalized.annualRevenue = raw === "" ? null : Number(raw);
  }
  return normalized;
}

export function validateAccount(normalized, existing = {}) {
  const candidate = { ...existing, ...normalized };
  const issues = [];
  const issue = (field, message) => issues.push({ field, message });
  if (!text(candidate.displayName)) issue("displayName", "Enter the company name.");
  for (const [field, [, maximum]] of Object.entries(TEXT_FIELDS))
    if (text(normalized[field]).length > maximum) issue(field, `Must be ${maximum} characters or fewer.`);
  if (normalized.email && !EMAIL_PATTERN.test(normalized.email)) issue("email", "Enter a valid email address.");
  for (const field of ["phone", "secondaryPhone"])
    if (normalized[field] && !usablePhone(normalized[field])) issue(field, "Enter a phone number with 7 to 15 digits.");
  if (normalized.website && !/^https?:\/\/[^\s/.]+\.[^\s]+$/i.test(normalized.website)) issue("website", "Enter a valid website, such as acme.example.");
  if (normalized.accountType && !TYPES.has(normalized.accountType)) issue("accountType", "Choose an account type.");
  if (normalized.employeeRange && !EMPLOYEE_RANGES.includes(normalized.employeeRange)) issue("employeeRange", "Choose a company size.");
  if (normalized.sourceId && !isUuid(normalized.sourceId)) issue("sourceId", "Choose a source.");
  if (normalized.currencyCode && !/^[A-Z]{3}$/.test(normalized.currencyCode)) issue("currencyCode", "Choose a currency.");
  if (has(normalized, "annualRevenue") && normalized.annualRevenue !== null) {
    const value = normalized.annualRevenue;
    if (!Number.isFinite(value) || value < 0 || value > MAX_REVENUE) issue("annualRevenue", "Enter an annual revenue of zero or more.");
  }
  return issues;
}

export function assertValidAccount(normalized, existing) {
  const issues = validateAccount(normalized, existing);
  if (issues.length) throw new CrmError(400, issues[0].message, "CRM_ACCOUNT_VALIDATION", { issues });
}
