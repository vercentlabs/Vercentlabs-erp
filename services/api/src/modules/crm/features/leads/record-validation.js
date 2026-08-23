const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LEAD_STATUSES = new Set([
  "new",
  "contacted",
  "working",
  "qualified",
  "unqualified",
  "converted",
  "archived",
]);
const ACTIVE_CREATE_STATUSES = new Set([
  "new",
  "contacted",
  "working",
  "qualified",
  "unqualified",
]);
const PRIORITIES = new Set(["low", "medium", "high", "urgent"]);
const RATINGS = new Set(["cold", "warm", "hot"]);

const TEXT_LIMITS = Object.freeze({
  firstName: 120,
  lastName: 120,
  email: 320,
  phone: 30,
  mobile: 30,
  companyName: 240,
  jobTitle: 160,
  website: 500,
  industry: 160,
  city: 160,
  state: 160,
  productInterest: 4_000,
  unqualifiedReason: 2_000,
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

export function normalizeLeadRecordInput(input = {}) {
  const normalized = { ...input };
  for (const field of NORMALIZED_TEXT_FIELDS) {
    if (!hasOwn(normalized, field)) continue;
    const value = text(normalized[field]);
    normalized[field] = value || null;
  }
  if (hasOwn(normalized, "email") && normalized.email)
    normalized.email = String(normalized.email).toLowerCase();
  if (hasOwn(normalized, "currencyCode") && normalized.currencyCode)
    normalized.currencyCode = text(normalized.currencyCode).toUpperCase();
  if (hasOwn(normalized, "countryCode") && normalized.countryCode)
    normalized.countryCode = text(normalized.countryCode).toUpperCase();
  return normalized;
}

export function validateLeadRecord(input = {}, options = {}) {
  const mode = options.mode === "update" ? "update" : "create";
  const existing =
    options.existing && typeof options.existing === "object"
      ? options.existing
      : {};
  const candidate = { ...existing, ...input };
  const errors = [];

  if (!text(candidate.firstName)) {
    errors.push(
      issue(
        "firstName",
        "First name is required.",
        "CRM_LEAD_FIRST_NAME_REQUIRED",
      ),
    );
  }

  const contactMethods = [candidate.email, candidate.mobile, candidate.phone]
    .map(text)
    .filter(Boolean);
  if (!contactMethods.length) {
    errors.push(
      issue(
        "email",
        "Provide at least one contact method: email, mobile number or alternate number.",
        "CRM_LEAD_CONTACT_REQUIRED",
      ),
    );
  }

  if (text(candidate.email) && !EMAIL_PATTERN.test(text(candidate.email))) {
    errors.push(
      issue(
        "email",
        "Email must be a valid email address.",
        "CRM_LEAD_EMAIL_INVALID",
      ),
    );
  }

  if (text(candidate.website)) {
    try {
      const url = new URL(text(candidate.website));
      if (!new Set(["http:", "https:"]).has(url.protocol))
        throw new Error("unsupported protocol");
    } catch {
      errors.push(
        issue(
          "website",
          "Website must be a valid http or https URL.",
          "CRM_LEAD_WEBSITE_INVALID",
        ),
      );
    }
  }

  for (const [field, maximum] of Object.entries(TEXT_LIMITS)) {
    if (text(candidate[field]).length > maximum) {
      errors.push(
        issue(field, `${field} is too long.`, "CRM_LEAD_TEXT_TOO_LONG"),
      );
    }
  }

  if (
    candidate.estimatedValue !== undefined &&
    candidate.estimatedValue !== null &&
    candidate.estimatedValue !== ""
  ) {
    const value = Number(candidate.estimatedValue);
    if (!Number.isFinite(value) || value < 0) {
      errors.push(
        issue(
          "estimatedValue",
          "Estimated value must be zero or greater.",
          "CRM_LEAD_ESTIMATED_VALUE_INVALID",
        ),
      );
    }
  }

  if (
    text(candidate.currencyCode) &&
    !/^[A-Z]{3}$/.test(text(candidate.currencyCode).toUpperCase())
  ) {
    errors.push(
      issue(
        "currencyCode",
        "Currency must be a 3-letter code.",
        "CRM_LEAD_CURRENCY_INVALID",
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
        "CRM_LEAD_COUNTRY_INVALID",
      ),
    );
  }

  const status = text(candidate.status || "new");
  if (status && !LEAD_STATUSES.has(status)) {
    errors.push(
      issue(
        "status",
        "Lead status is not supported.",
        "CRM_LEAD_STATUS_INVALID",
      ),
    );
  } else if (mode === "create" && !ACTIVE_CREATE_STATUSES.has(status)) {
    errors.push(
      issue(
        "status",
        "A new lead cannot start in a terminal status.",
        "CRM_LEAD_INITIAL_STATUS_INVALID",
      ),
    );
  }

  const priority = text(candidate.priority || "medium");
  if (priority && !PRIORITIES.has(priority))
    errors.push(
      issue(
        "priority",
        "Lead priority is not supported.",
        "CRM_LEAD_PRIORITY_INVALID",
      ),
    );

  const rating = text(candidate.rating || "warm");
  if (rating && !RATINGS.has(rating))
    errors.push(
      issue(
        "rating",
        "Lead rating is not supported.",
        "CRM_LEAD_RATING_INVALID",
      ),
    );

  return errors;
}
