// Small, shared field-level visibility helper used by the HR & Payroll,
// Support, and Procurement service modules to enforce the
// hr_payroll.sensitive.view / support.sensitive.view /
// procurement.suppliers.sensitive permissions documented in
// docs/implementation/ERP_SECURITY_HARDENING_003.md.
//
// This intentionally stays tiny: it does not attempt to be a general
// field-permission framework, only the two operations every call site in
// this prompt needs — omit a fixed set of keys from an object (read side),
// and detect whether a caller-submitted payload is attempting to touch any
// of those keys (write side).

export function omitFields(row, fields) {
  if (!row || typeof row !== "object") return row;
  const clone = { ...row };
  for (const field of fields) delete clone[field];
  return clone;
}

export function omitFieldsFromRows(rows, fields) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => omitFields(row, fields));
}

export function hasAnyOwnField(payload, fields) {
  if (!payload || typeof payload !== "object") return false;
  return fields.some((field) => Object.prototype.hasOwnProperty.call(payload, field));
}
