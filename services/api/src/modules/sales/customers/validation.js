// Input normalization and validation for the customer record. Required:
// customer name, customer type, country and currency. GST details are
// required only for an Indian customer whose registration type carries a
// GSTIN.
import { CUSTOMER_KINDS, CustomerError, GST_REGISTRATION_TYPES, GST_STATES } from "./constants.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const KINDS = new Set(CUSTOMER_KINDS.map((entry) => entry.code));
const REGISTRATIONS = new Map(GST_REGISTRATION_TYPES.map((entry) => [entry.code, entry]));
const STATES = new Set(GST_STATES.map((state) => state.code));

export const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
export const text = (value) => String(value ?? "").trim();
export const isUuid = (value) => UUID.test(String(value ?? ""));

export function requireUuid(value, label) {
  if (!isUuid(value)) throw new CustomerError(400, `${label} is not valid.`, "SALES_CUSTOMER_VALIDATION");
  return String(value);
}

// field -> [column, maximum length]
const TEXT_FIELDS = Object.freeze({
  displayName: ["display_name", 240],
  legalName: ["legal_name", 240],
  email: ["email", 320],
  phone: ["phone", 30],
  website: ["website", 500],
  notes: ["customer_notes", 10000],
});

// Every field createCustomer / updateCustomer accepts, with its column.
export const CUSTOMER_COLUMNS = Object.freeze({
  ...Object.fromEntries(Object.entries(TEXT_FIELDS).map(([field, [column]]) => [field, column])),
  customerKind: "customer_kind",
  countryCode: "country_code",
  currencyCode: "currency_code",
  priceListId: "default_price_list_id",
  paymentTermId: "payment_term_id",
  gstRegistrationType: "tax_treatment",
  gstin: "gstin",
  pan: "pan",
  gstStateCode: "gst_state_code",
  placeOfSupply: "place_of_supply",
  ownerUserId: "owner_user_id",
});

export const CUSTOMER_FIELD_LABELS = Object.freeze({
  displayName: "Customer name", legalName: "Legal name", email: "Email", phone: "Phone", website: "Website", notes: "Notes", customerKind: "Customer type",
  countryCode: "Country", currencyCode: "Currency", priceListId: "Price list", paymentTermId: "Payment terms", gstRegistrationType: "GST registration type",
  gstin: "GSTIN", pan: "PAN", gstStateCode: "GST state", placeOfSupply: "Place of supply", ownerUserId: "Salesperson",
});

function normalizeWebsite(value) {
  const site = text(value);
  if (!site) return null;
  return /^https?:\/\//i.test(site) ? site : `https://${site}`;
}

// Returns only the fields present in `input`, trimmed and typed.
export function normalizeCustomerInput(input = {}) {
  const normalized = {};
  for (const field of Object.keys(TEXT_FIELDS)) if (has(input, field)) normalized[field] = text(input[field]) || null;
  if (normalized.email) normalized.email = normalized.email.toLowerCase();
  if (has(normalized, "website")) normalized.website = normalizeWebsite(normalized.website);
  for (const field of ["customerKind", "gstRegistrationType"]) if (has(input, field)) normalized[field] = text(input[field]).toLowerCase() || null;
  for (const field of ["countryCode", "currencyCode", "gstin", "pan"]) if (has(input, field)) normalized[field] = text(input[field]).toUpperCase() || null;
  for (const field of ["priceListId", "paymentTermId", "ownerUserId", "gstStateCode", "placeOfSupply"]) if (has(input, field)) normalized[field] = text(input[field]) || null;
  // The GSTIN carries the state and the PAN.
  if (normalized.gstin && GSTIN.test(normalized.gstin)) {
    normalized.gstStateCode = normalized.gstin.slice(0, 2);
    if (!normalized.pan) normalized.pan = normalized.gstin.slice(2, 12);
  }
  return normalized;
}

// `existing` is the stored customer (camelCase) when updating.
export function validateCustomer(normalized, existing = {}) {
  const candidate = { ...existing, ...normalized };
  const issues = [];
  const issue = (field, message) => issues.push({ field, message });
  if (!text(candidate.displayName)) issue("displayName", "Enter the customer name.");
  if (!KINDS.has(candidate.customerKind)) issue("customerKind", "Choose whether the customer is a business or an individual.");
  if (!/^[A-Z]{2}$/.test(text(candidate.countryCode))) issue("countryCode", "Choose the country.");
  if (!/^[A-Z]{3}$/.test(text(candidate.currencyCode))) issue("currencyCode", "Choose the currency.");
  for (const [field, [, maximum]] of Object.entries(TEXT_FIELDS))
    if (text(normalized[field]).length > maximum) issue(field, `Must be ${maximum} characters or fewer.`);
  if (normalized.email && !EMAIL.test(normalized.email)) issue("email", "Enter a valid email address.");
  if (normalized.phone) {
    const digits = normalized.phone.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) issue("phone", "Enter a phone number with 7 to 15 digits.");
  }
  if (normalized.website && !/^https?:\/\/[^\s/.]+\.[^\s]+$/i.test(normalized.website)) issue("website", "Enter a valid website, such as acme.example.");
  for (const [field, label] of [["priceListId", "a price list"], ["paymentTermId", "payment terms"], ["ownerUserId", "a salesperson"]])
    if (normalized[field] && !isUuid(normalized[field])) issue(field, `Choose ${label}.`);

  const registration = candidate.gstRegistrationType ? REGISTRATIONS.get(candidate.gstRegistrationType) : null;
  if (candidate.gstRegistrationType && !registration) issue("gstRegistrationType", "Choose a GST registration type.");
  if (candidate.gstin && !GSTIN.test(candidate.gstin)) issue("gstin", "Enter a valid 15-character GSTIN.");
  if (candidate.pan && !PAN.test(candidate.pan)) issue("pan", "Enter a valid 10-character PAN.");
  if (candidate.gstin && candidate.pan && GSTIN.test(candidate.gstin) && candidate.gstin.slice(2, 12) !== candidate.pan) issue("pan", "The PAN does not match the GSTIN.");
  for (const field of ["gstStateCode", "placeOfSupply"])
    if (candidate[field] && !STATES.has(candidate[field])) issue(field, "Choose a state.");
  if (candidate.countryCode === "IN") {
    if (registration?.needsGstin && !candidate.gstin) issue("gstin", `Enter the GSTIN. It is required for a ${registration.label} customer.`);
    if (registration && !registration.needsGstin && candidate.gstin && ["unregistered", "consumer", "overseas"].includes(registration.code))
      issue("gstRegistrationType", "A customer with a GSTIN is a registered customer. Choose a registered type, or clear the GSTIN.");
    if (candidate.gstRegistrationType === "overseas") issue("gstRegistrationType", "An overseas customer cannot have India as its country.");
  } else if (/^[A-Z]{2}$/.test(text(candidate.countryCode))) {
    if (candidate.gstin) issue("gstin", "Only a customer in India has a GSTIN.");
  }
  return issues;
}

export function assertValidCustomer(normalized, existing) {
  const issues = validateCustomer(normalized, existing);
  if (issues.length) throw new CustomerError(400, issues[0].message, "SALES_CUSTOMER_VALIDATION", { issues });
}
