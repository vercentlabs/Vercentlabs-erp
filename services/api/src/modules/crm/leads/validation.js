// Input normalization and validation for the lead record. A lead often
// arrives incomplete, so only an identity is required: a person's name or a
// company. Everything else is optional and validated only when present.
import { CrmError } from "../data-management/errors.js";
import { LEAD_PRIORITIES, LEAD_PURCHASE_TIMEFRAMES, LEAD_RATINGS } from "./constants.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ESTIMATED_VALUE = 1_000_000_000_000;
const TIMEFRAMES = new Set(LEAD_PURCHASE_TIMEFRAMES.map((entry) => entry.code));

// camelCase input field -> column, with its maximum length.
const TEXT_FIELDS = Object.freeze({
  firstName: ["first_name", 120],
  lastName: ["last_name", 120],
  companyName: ["company_name", 240],
  jobTitle: ["job_title", 160],
  email: ["email", 320],
  phone: ["phone", 30],
  mobile: ["mobile", 30],
  website: ["website", 500],
  city: ["city", 160],
  state: ["state", 160],
  sourceDetail: ["source_detail", 240],
  industry: ["industry", 160],
  productInterest: ["product_interest", 4000],
  description: ["description", 10000],
});

// Fields the generic create/update accept. Owner, team, stage, status,
// qualification and conversion change only through their own operations.
export const LEAD_WRITABLE_COLUMNS = Object.freeze({
  ...Object.fromEntries(Object.entries(TEXT_FIELDS).map(([field, [column]]) => [field, column])),
  countryCode: "country_code",
  currencyCode: "currency_code",
  sourceId: "source_id",
  estimatedValue: "estimated_value",
  purchaseTimeframe: "purchase_timeframe",
  priority: "priority",
  rating: "rating",
});

const GOVERNED_FIELDS = Object.freeze({
  stage: "Use Change Stage to move a lead between stages.",
  status: "Status changes through Qualify, Disqualify, Reopen and Convert.",
  convertedPartyId: "Conversion references are set by Convert Lead.",
  convertedContactId: "Conversion references are set by Convert Lead.",
  convertedOpportunityId: "Conversion references are set by Convert Lead.",
  convertedAt: "Conversion references are set by Convert Lead.",
  convertedBy: "Conversion references are set by Convert Lead.",
  code: "The lead number is generated automatically.",
});

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const text = (value) => String(value ?? "").trim();

export function isUuid(value) {
  return UUID_PATTERN.test(String(value ?? ""));
}

export function requireUuid(value, label) {
  if (!isUuid(value)) throw new CrmError(400, `${label} is not valid.`, "CRM_LEAD_VALIDATION");
  return String(value);
}

function usablePhone(value) {
  const digits = text(value).replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

// Returns only the fields present in `input`, trimmed and typed. Empty
// strings become null so "cleared" and "never set" are stored the same way.
export function normalizeLeadInput(input = {}) {
  for (const [field, message] of Object.entries(GOVERNED_FIELDS))
    if (has(input, field)) throw new CrmError(409, message, "CRM_LEAD_FIELD_GOVERNED");
  const normalized = {};
  for (const field of Object.keys(TEXT_FIELDS)) {
    if (!has(input, field)) continue;
    normalized[field] = text(input[field]) || null;
  }
  if (normalized.email) normalized.email = normalized.email.toLowerCase();
  for (const field of ["countryCode", "currencyCode"]) {
    if (!has(input, field)) continue;
    normalized[field] = text(input[field]).toUpperCase() || null;
  }
  for (const field of ["sourceId", "purchaseTimeframe"]) {
    if (!has(input, field)) continue;
    normalized[field] = text(input[field]) || null;
  }
  // Priority and rating are never empty: an untouched select keeps the default.
  for (const field of ["priority", "rating"]) {
    if (has(input, field) && text(input[field])) normalized[field] = text(input[field]).toLowerCase();
  }
  if (has(input, "estimatedValue")) {
    const raw = input.estimatedValue;
    normalized.estimatedValue = raw === null || text(raw) === "" ? 0 : Number(raw);
  }
  return normalized;
}

// `existing` is the stored record on update, so the identity rule is checked
// against what the record will be after the change.
export function validateLead(normalized, existing = {}) {
  const candidate = { ...existing, ...normalized };
  const issues = [];
  const issue = (field, message) => issues.push({ field, message });

  if (!text(candidate.firstName) && !text(candidate.lastName) && !text(candidate.companyName))
    issue("firstName", "Enter a name or a company for this lead.");
  for (const [field, [, maximum]] of Object.entries(TEXT_FIELDS)) {
    if (text(normalized[field]).length > maximum) issue(field, `Must be ${maximum} characters or fewer.`);
  }
  if (normalized.email && !EMAIL_PATTERN.test(normalized.email)) issue("email", "Enter a valid email address.");
  for (const field of ["phone", "mobile"]) {
    if (normalized[field] && !usablePhone(normalized[field])) issue(field, "Enter a phone number with 7 to 15 digits.");
  }
  if (normalized.countryCode && !/^[A-Z]{2}$/.test(normalized.countryCode)) issue("countryCode", "Choose a country.");
  if (normalized.currencyCode && !/^[A-Z]{3}$/.test(normalized.currencyCode)) issue("currencyCode", "Choose a currency.");
  if (normalized.sourceId && !isUuid(normalized.sourceId)) issue("sourceId", "Choose a lead source.");
  if (normalized.purchaseTimeframe && !TIMEFRAMES.has(normalized.purchaseTimeframe)) issue("purchaseTimeframe", "Choose a purchase timeframe.");
  if (normalized.priority && !LEAD_PRIORITIES.includes(normalized.priority)) issue("priority", "Priority must be low, medium or high.");
  if (normalized.rating && !LEAD_RATINGS.includes(normalized.rating)) issue("rating", "Rating must be cold, warm or hot.");
  if (has(normalized, "estimatedValue")) {
    const value = normalized.estimatedValue;
    if (!Number.isFinite(value) || value < 0 || value > MAX_ESTIMATED_VALUE) issue("estimatedValue", "Enter an estimated value of zero or more.");
  }
  return issues;
}

export function assertValidLead(normalized, existing) {
  const issues = validateLead(normalized, existing);
  if (issues.length) throw new CrmError(400, issues[0].message, "CRM_LEAD_VALIDATION", { issues });
}
