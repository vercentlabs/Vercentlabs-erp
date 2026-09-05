export const CONTACT_SENSITIVE_PERMISSION = "crm.contacts.view_sensitive";

const SENSITIVE_CONTACT_FIELDS = Object.freeze(["email", "phone", "mobile"]);

export function canViewSensitiveContactContent(context) {
  return (
    Boolean(context.roleSlugs?.includes("organization_owner")) ||
    Boolean(context.permissions?.includes(CONTACT_SENSITIVE_PERMISSION))
  );
}

export function projectContactForContext(context, record) {
  if (!record || typeof record !== "object" || canViewSensitiveContactContent(context))
    return record;
  const projected = { ...record };
  for (const field of SENSITIVE_CONTACT_FIELDS) delete projected[field];
  projected.sensitiveDataRestricted = true;
  return projected;
}

export function contactSearchColumnsForContext(context, columns = []) {
  if (canViewSensitiveContactContent(context)) return columns;
  const forbidden = new Set(["email", "phone", "mobile"]);
  return columns.filter((column) => !forbidden.has(column));
}

export function firstSensitiveContactInputField(input = {}) {
  return Object.keys(input || {}).find((key) => SENSITIVE_CONTACT_FIELDS.includes(key));
}
