const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TEXT_LIMITS = Object.freeze({
  firstName: 120,
  lastName: 120,
  designation: 160,
  email: 254,
  phone: 40,
  mobile: 40,
});

// BCP-47 language tag — deliberately permissive (Intl.getCanonicalLocales
// is the authority below); this only bounds length before that check runs.
const LANGUAGE_MAX = 35;

function isValidIanaTimeZone(value) {
  try {
    // Intl.DateTimeFormat throws RangeError for any string that is not a
    // real IANA zone name — this is the canonical-identifier check the
    // dossier requires ("never an ambiguous locale string"), not a
    // hand-rolled allowlist.
    new Intl.DateTimeFormat(undefined, { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function isValidLanguageTag(value) {
  try {
    return Intl.getCanonicalLocales(value).length > 0;
  } catch {
    return false;
  }
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function text(value) {
  return String(value ?? "").trim();
}

function issue(field, message, code) {
  return { field, message, code };
}

function validPhone(value) {
  const candidate = text(value);
  if (!candidate) return true;
  const digits = candidate.replace(/\D/g, "");
  return (
    digits.length >= 5 &&
    digits.length <= 20 &&
    /^[0-9+().\-\s]*(?:(?:x|ext\.?)[\s]*[0-9]+)?$/i.test(candidate)
  );
}

export function normalizeContactInput(input = {}) {
  const normalized = { ...input };
  for (const field of Object.keys(TEXT_LIMITS)) {
    if (!hasOwn(normalized, field)) continue;
    const value = text(normalized[field]);
    normalized[field] = value || null;
  }
  if (hasOwn(normalized, "email") && normalized.email) {
    normalized.email = String(normalized.email).toLowerCase();
  }
  if (hasOwn(normalized, "accountId")) {
    const value = text(normalized.accountId);
    normalized.accountId = value || null;
  }
  if (hasOwn(normalized, "status")) {
    normalized.status = text(normalized.status).toLowerCase();
  }
  if (hasOwn(normalized, "preferredLanguage")) {
    const value = text(normalized.preferredLanguage);
    normalized.preferredLanguage = value || null;
  }
  if (hasOwn(normalized, "timezone")) {
    const value = text(normalized.timezone);
    normalized.timezone = value || null;
  }
  return normalized;
}

export function validateContactInput(input = {}, options = {}) {
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
        "CRM_CONTACT_NAME_REQUIRED",
      ),
    );
  }

  if (
    !text(candidate.email) &&
    !text(candidate.mobile) &&
    !text(candidate.phone)
  ) {
    errors.push(
      issue(
        "email",
        "Add an email, mobile number or business phone.",
        "CRM_CONTACT_CONTACT_METHOD_REQUIRED",
      ),
    );
  }

  if (text(candidate.email) && !EMAIL_PATTERN.test(text(candidate.email))) {
    errors.push(
      issue(
        "email",
        "Enter a valid work email address.",
        "CRM_CONTACT_EMAIL_INVALID",
      ),
    );
  }

  for (const field of ["mobile", "phone"]) {
    if (!validPhone(candidate[field])) {
      errors.push(
        issue(
          field,
          `Enter a valid ${field === "mobile" ? "mobile number" : "business phone"}.`,
          "CRM_CONTACT_PHONE_INVALID",
        ),
      );
    }
  }

  for (const [field, maximum] of Object.entries(TEXT_LIMITS)) {
    if (text(candidate[field]).length > maximum) {
      errors.push(
        issue(
          field,
          `${field === "designation" ? "Job title" : field.replace(/([A-Z])/g, " $1")} is too long.`,
          "CRM_CONTACT_FIELD_TOO_LONG",
        ),
      );
    }
  }

  if (
    candidate.accountId &&
    !UUID_PATTERN.test(String(candidate.accountId))
  ) {
    errors.push(
      issue(
        "accountId",
        "Select a valid account.",
        "CRM_CONTACT_ACCOUNT_INVALID",
      ),
    );
  }

  if (
    hasOwn(candidate, "isPrimary") &&
    typeof candidate.isPrimary !== "boolean"
  ) {
    errors.push(
      issue(
        "isPrimary",
        "Primary contact must be yes or no.",
        "CRM_CONTACT_PRIMARY_INVALID",
      ),
    );
  }

  if (text(candidate.preferredLanguage)) {
    if (text(candidate.preferredLanguage).length > LANGUAGE_MAX) {
      errors.push(
        issue(
          "preferredLanguage",
          "Preferred language is too long.",
          "CRM_CONTACT_LANGUAGE_INVALID",
        ),
      );
    } else if (!isValidLanguageTag(text(candidate.preferredLanguage))) {
      errors.push(
        issue(
          "preferredLanguage",
          "Enter a valid language (e.g. en, en-IN, fr-CA).",
          "CRM_CONTACT_LANGUAGE_INVALID",
        ),
      );
    }
  }

  if (text(candidate.timezone) && !isValidIanaTimeZone(text(candidate.timezone))) {
    errors.push(
      issue(
        "timezone",
        "Enter a valid IANA time zone (e.g. Asia/Kolkata).",
        "CRM_CONTACT_TIMEZONE_INVALID",
      ),
    );
  }

  return errors;
}
