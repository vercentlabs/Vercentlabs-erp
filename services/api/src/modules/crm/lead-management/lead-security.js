export const LEAD_SENSITIVE_PERMISSION = "crm.leads.view_sensitive";

const SENSITIVE_LEAD_FIELDS = Object.freeze([
  "email",
  "phone",
  "mobile",
  "customData",
  "consentEmail",
  "consentSms",
  "consentWhatsapp",
  "doNotContact",
  "qualificationReasonText",
  "qualificationNote",
  "scoreExplanation",
  "normalizedEmail",
  "normalizedMobile",
  "normalizedBusinessPhone",
]);

const SENSITIVE_LEAD_INPUT_FIELDS = new Set([
  "email",
  "phone",
  "mobile",
  "customData",
  "consentEmail",
  "consentSms",
  "consentWhatsapp",
  "doNotContact",
  "qualificationReasonText",
  "qualificationNote",
]);

export function canViewAllLeadRecords(context) {
  return (
    Boolean(context.roleSlugs?.includes("organization_owner")) ||
    Boolean(context.permissions?.includes("crm.records.view_all"))
  );
}

export function canViewSensitiveLeadContent(context) {
  return (
    Boolean(context.roleSlugs?.includes("organization_owner")) ||
    Boolean(context.permissions?.includes(LEAD_SENSITIVE_PERMISSION))
  );
}

export function firstSensitiveLeadInputField(input = {}) {
  return Object.keys(input || {}).find((key) => SENSITIVE_LEAD_INPUT_FIELDS.has(key));
}

export function projectLeadForContext(context, record) {
  if (!record || typeof record !== "object" || canViewSensitiveLeadContent(context))
    return record;
  const projected = { ...record };
  for (const field of SENSITIVE_LEAD_FIELDS) delete projected[field];
  projected.sensitiveDataRestricted = true;
  return projected;
}

export function leadScopeSql(context, values, alias = "lead") {
  let sql = "";
  sql += crmOwnerScopeSql(context, (value) => { values.push(value); return `$${values.length}`; }, `${alias}.owner_user_id`, `${alias}.organization_id`, { resource: "leads", alias: alias });
  return sql;
}

export function leadSearchColumnsForContext(context, columns = []) {
  if (canViewSensitiveLeadContent(context)) return columns;
  const forbidden = new Set(["email", "phone", "mobile", "normalized_email", "normalized_mobile", "normalized_business_phone"]);
  return columns.filter((column) => !forbidden.has(column));
}import { crmOwnerScopeSql } from "../data-management/crm-access-scope.js";

