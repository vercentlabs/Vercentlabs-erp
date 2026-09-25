export const CONTACT_SENSITIVE_PERMISSION = "crm.contacts.view_sensitive";

// normalizedEmail/normalizedMobile are GENERATED columns derived directly
// from email/mobile (added by migration 091_f008_account_contact_matching_performance.sql
// for fast duplicate-search indexing) — a real leak found by the
// erp-crm-sensitive-projection.spec.ts browser E2E gate: the raw
// contactSelect() `SELECT contact.*` picks them up automatically, and they
// were missing from this list, so a restricted viewer received the
// (lightly normalized, but still identifying) email/mobile value even
// though `email`/`mobile` themselves were correctly deleted.
const SENSITIVE_CONTACT_FIELDS = Object.freeze([
  "email",
  "phone",
  "mobile",
  "normalizedEmail",
  "normalizedMobile",
]);

export function canViewSensitiveContactContent(context) {
  return (
    Boolean(context.roleSlugs?.includes("organization_owner")) ||
    Boolean(context.permissions?.includes(CONTACT_SENSITIVE_PERMISSION))
  );
}

function snakeCase(value) {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

// Strips both spellings — see account-security.js's projectAccountForContext
// for why: account-intelligence.js's merge-preview/Customer-360 read paths
// pass this RAW Postgres rows (never camelizeRow()'d), so a camelCase-only
// delete list silently failed to strip normalized_email/normalized_mobile
// from those rows.
export function projectContactForContext(context, record) {
  if (!record || typeof record !== "object" || canViewSensitiveContactContent(context))
    return record;
  const projected = { ...record };
  for (const field of SENSITIVE_CONTACT_FIELDS) {
    delete projected[field];
    delete projected[snakeCase(field)];
  }
  projected.sensitiveDataRestricted = true;
  return projected;
}

export function contactSearchColumnsForContext(context, columns = []) {
  if (canViewSensitiveContactContent(context)) return columns;
  const forbidden = new Set(["email", "phone", "mobile", "normalized_email", "normalized_mobile"]);
  return columns.filter((column) => !forbidden.has(column));
}

export function firstSensitiveContactInputField(input = {}) {
  return Object.keys(input || {}).find((key) => SENSITIVE_CONTACT_FIELDS.includes(key));
}
