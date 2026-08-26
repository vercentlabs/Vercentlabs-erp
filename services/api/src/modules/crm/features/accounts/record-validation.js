const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCOUNT_TYPES = new Set(["customer", "both", "prospect"]);
const ACCOUNT_STATUSES = new Set(["active", "inactive"]);

const TEXT_LIMITS = Object.freeze({
  displayName: 180,
  legalName: 180,
  industry: 160,
  website: 500,
  phone: 30,
  email: 254,
  gstin: 15,
  pan: 10,
  addressLine1: 200,
  addressLine2: 160,
  city: 120,
  state: 120,
  postalCode: 20,
});

const NORMALIZED_TEXT_FIELDS = Object.freeze(Object.keys(TEXT_LIMITS));

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function text(value) {
  return String(value ?? "").trim();
}

function issue(field, message, code) {
  return { field, message, code };
}

export function normalizeAccountInput(input = {}) {
  const normalized = { ...input };
  for (const field of NORMALIZED_TEXT_FIELDS) {
    if (!hasOwn(normalized, field)) continue;
    const value = text(normalized[field]);
    normalized[field] = value || null;
  }
  if (hasOwn(normalized, "email") && normalized.email) {
    normalized.email = String(normalized.email).toLowerCase();
  }
  for (const field of ["countryCode", "currencyCode", "gstin", "pan"]) {
    if (!hasOwn(normalized, field)) continue;
    const value = text(normalized[field]).toUpperCase();
    normalized[field] = value || null;
  }
  if (hasOwn(normalized, "companyId")) {
    const value = text(normalized.companyId);
    normalized.companyId = value || null;
  }
  if (hasOwn(normalized, "partyType")) {
    normalized.partyType = text(normalized.partyType).toLowerCase();
  }
  if (hasOwn(normalized, "status")) {
    normalized.status = text(normalized.status).toLowerCase();
  }
  return normalized;
}

export function validateAccountInput(input = {}, options = {}) {
  const existing =
    options.existing && typeof options.existing === "object"
      ? options.existing
      : {};
  const candidate = { ...existing, ...input };
  const errors = [];

  if (!text(candidate.displayName)) {
    errors.push(
      issue(
        "displayName",
        "Company name is required.",
        "CRM_ACCOUNT_NAME_REQUIRED",
      ),
    );
  }

  if (text(candidate.email) && !EMAIL_PATTERN.test(text(candidate.email))) {
    errors.push(
      issue(
        "email",
        "Enter a valid company email address.",
        "CRM_ACCOUNT_EMAIL_INVALID",
      ),
    );
  }

  if (text(candidate.website)) {
    try {
      const url = new URL(text(candidate.website));
      if (!new Set(["http:", "https:"]).has(url.protocol)) {
        throw new Error("unsupported scheme");
      }
    } catch {
      errors.push(
        issue(
          "website",
          "Enter a valid website beginning with http:// or https://.",
          "CRM_ACCOUNT_WEBSITE_INVALID",
        ),
      );
    }
  }

  const partyType = text(candidate.partyType || "prospect");
  if (!ACCOUNT_TYPES.has(partyType)) {
    errors.push(
      issue(
        "partyType",
        "Select a supported CRM account type.",
        "CRM_ACCOUNT_TYPE_INVALID",
      ),
    );
  }

  const status = text(candidate.status || "active");
  if (!ACCOUNT_STATUSES.has(status)) {
    errors.push(
      issue(
        "status",
        "Select a supported account status.",
        "CRM_ACCOUNT_STATUS_INVALID",
      ),
    );
  }

  if (
    text(candidate.currencyCode) &&
    !/^[A-Z]{3}$/.test(text(candidate.currencyCode).toUpperCase())
  ) {
    errors.push(
      issue(
        "currencyCode",
        "Currency must be a 3-letter code.",
        "CRM_ACCOUNT_CURRENCY_INVALID",
      ),
    );
  }

  if (
    text(candidate.countryCode) &&
    !/^[A-Z]{2}$/.test(text(candidate.countryCode).toUpperCase())
  ) {
    errors.push(
      issue(
        "countryCode",
        "Country must be a 2-letter code.",
        "CRM_ACCOUNT_COUNTRY_INVALID",
      ),
    );
  }

  for (const [field, maximum] of Object.entries(TEXT_LIMITS)) {
    if (text(candidate[field]).length > maximum) {
      errors.push(
        issue(field, `${field} is too long.`, "CRM_ACCOUNT_TEXT_TOO_LONG"),
      );
    }
  }

  return errors;
}
