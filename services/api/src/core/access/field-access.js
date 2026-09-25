// Field-level access: read projection and write guarding for sensitive
// fields. A field rule is `{ permission, fields }` — callers without the
// permission never see the fields and may never write them.
//
// Wraps the existing ../field-visibility.js primitives (used by HR/Support/
// Procurement) rather than replacing them; module-specific projections
// (e.g. CRM sensitive contact data) keep their own richer implementations.
import { hasAnyOwnField, omitFields, omitFieldsFromRows } from "../field-visibility.js";
import { ACCESS_ERROR_CODES, AccessDeniedError } from "./errors.js";
import { principalHasPermission } from "./principal.js";

export { hasAnyOwnField, omitFields, omitFieldsFromRows };

export function hiddenFieldsFor(principal, rules) {
  const hidden = new Set();
  for (const rule of rules || []) {
    if (!principalHasPermission(principal, rule.permission)) for (const field of rule.fields) hidden.add(field);
  }
  return [...hidden];
}

export function projectFields(principal, rowOrRows, rules) {
  const hidden = hiddenFieldsFor(principal, rules);
  if (!hidden.length) return rowOrRows;
  return Array.isArray(rowOrRows) ? omitFieldsFromRows(rowOrRows, hidden) : omitFields(rowOrRows, hidden);
}

export function assertWritableFields(principal, payload, rules, { module } = {}) {
  const hidden = hiddenFieldsFor(principal, rules);
  if (hidden.length && hasAnyOwnField(payload, hidden)) {
    throw new AccessDeniedError(ACCESS_ERROR_CODES.FIELD_ACCESS_DENIED, { module, reason: "field_write" });
  }
  return payload;
}
