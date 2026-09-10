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
  if (context.activeCompanyId) {
    values.push(context.activeCompanyId);
    sql += ` AND (${alias}.company_id IS NULL OR ${alias}.company_id=$${values.length})`;
  } else if (!context.allowAllCompanies) {
    return " AND false";
  }
  if (context.activeBranchId) {
    values.push(context.activeBranchId);
    sql += ` AND (${alias}.branch_id IS NULL OR ${alias}.branch_id=$${values.length})`;
  } else if (!context.allowAllCompanies) {
    return sql + " AND false";
  }
  if (!canViewAllLeadRecords(context)) {
    values.push(context.userId);
    sql += ` AND (${alias}.owner_user_id IS NULL OR ${alias}.owner_user_id=$${values.length})`;
  }
  return sql;
}

export function leadSearchColumnsForContext(context, columns = []) {
  if (canViewSensitiveLeadContent(context)) return columns;
  const forbidden = new Set(["email", "phone", "mobile", "normalized_email", "normalized_mobile", "normalized_business_phone"]);
  return columns.filter((column) => !forbidden.has(column));
}
