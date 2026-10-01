// Canonical Account sensitive-field projection — mirrors lead-security.js
// and contact-security.js exactly (CRM vNext Prompt 1's established
// pattern: one server-side projection per entity, reused by every
// consumer, never a UI-only redaction). Closes CRM-VNEXT-004/035: Account
// legal/tax identifiers (GSTIN, PAN, MSME registration number) were
// previously returned to any caller with ordinary account view access,
// with no distinction from the record-level `crm.view` permission.
export const ACCOUNT_SENSITIVE_PERMISSION = "crm.accounts.view_sensitive";

// normalizedPan is a GENERATED column derived directly from pan (added by
// migration 091_f008_account_contact_matching_performance.sql for fast
// duplicate-search indexing) — the same class of leak the
// erp-crm-sensitive-projection.spec.ts browser E2E gate found for Contacts'
// normalizedEmail/normalizedMobile: `SELECT party.*` picks it up
// automatically, and it was missing from this list. normalizedLegalName is
// NOT included — it derives from legal_name/display_name, neither of which
// is sensitive.
const SENSITIVE_ACCOUNT_FIELDS = Object.freeze(["gstin", "pan", "msmeNumber", "normalizedPan"]);

export function canViewSensitiveAccountContent(context) {
  return (
    Boolean(context.roleSlugs?.includes("organization_owner")) ||
    Boolean(context.permissions?.includes(ACCOUNT_SENSITIVE_PERMISSION))
  );
}

function snakeCase(value) {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

// Strips both the camelCase field name AND its snake_case column name.
// account-intelligence.js's merge-preview/Customer-360 read paths pass this
// function RAW Postgres rows (never camelizeRow()'d, unlike
// getCrmAccount/getCrmAccountForCaller in account-operations.js) — a
// camelCase-only delete list silently failed to strip msme_number/
// normalized_pan from those raw rows, the exact class of leak
// CRM-VNEXT-004/035 already fixed once for the camelized path. Deleting
// both spellings makes this safe regardless of which shape the caller hands
// in, rather than requiring every future raw-row call site to remember to
// camelize first.
export function projectAccountForContext(context, record) {
  if (!record || typeof record !== "object" || canViewSensitiveAccountContent(context))
    return record;
  const projected = { ...record };
  for (const field of SENSITIVE_ACCOUNT_FIELDS) {
    delete projected[field];
    delete projected[snakeCase(field)];
  }
  projected.sensitiveDataRestricted = true;
  return projected;
}

export function accountSearchColumnsForContext(context, columns = []) {
  if (canViewSensitiveAccountContent(context)) return columns;
  const forbidden = new Set(["gstin", "pan", "msme_number", "normalized_pan"]);
  return columns.filter((column) => !forbidden.has(column));
}

export function firstSensitiveAccountInputField(input = {}) {
  return Object.keys(input || {}).find((key) => SENSITIVE_ACCOUNT_FIELDS.includes(key));
}
