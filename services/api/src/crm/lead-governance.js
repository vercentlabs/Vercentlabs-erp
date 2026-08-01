export class LeadGovernanceError extends Error {
  constructor(
    status,
    message,
    code = "CRM_LEAD_GOVERNANCE_ERROR",
    details = [],
  ) {
    super(message);
    this.name = "LeadGovernanceError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const text = (v) => String(v ?? "").trim();
const normal = (v) =>
  text(v)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
const email = (v) => text(v).toLowerCase();
const phone = (v) => text(v).replace(/\D+/g, "").slice(-15);
function matches(criteria, input) {
  return Object.entries(criteria || {}).every(([k, v]) =>
    Array.isArray(v)
      ? v.map(String).includes(String(input[k] ?? ""))
      : String(input[k] ?? "") === String(v),
  );
}
export async function getLeadConfiguration(
  client,
  context,
  recordTypeKey = "standard",
) {
  const rt = await client.query(
    `SELECT * FROM tenant.crm_lead_record_types WHERE organization_id=$1 AND key=$2 AND status='active' LIMIT 1`,
    [context.organizationId, recordTypeKey],
  );
  if (!rt.rows[0])
    throw new LeadGovernanceError(
      404,
      "Lead record type not found.",
      "CRM_LEAD_RECORD_TYPE_NOT_FOUND",
    );
  const [fields, layouts, policies] = await Promise.all([
    client.query(
      `SELECT field_key,label,data_type,storage,standard_column,help_text,placeholder,options,default_value,required,searchable,unique_value FROM tenant.crm_lead_field_definitions WHERE organization_id=$1 AND status='active' ORDER BY created_at,id`,
      [context.organizationId],
    ),
    client.query(
      `SELECT id,name,sections,visibility_rules,validation_rules FROM tenant.crm_lead_layouts WHERE organization_id=$1 AND record_type_id=$2 AND status='active' ORDER BY created_at LIMIT 1`,
      [context.organizationId, rt.rows[0].id],
    ),
    client.query(
      `SELECT id,name,sequence,criteria,mode,assignee_user_id,member_user_ids,territory_id FROM tenant.crm_lead_assignment_policies WHERE organization_id=$1 AND status='active' ORDER BY sequence,id`,
      [context.organizationId],
    ),
  ]);
  return {
    recordType: rt.rows[0],
    fields: fields.rows,
    layout: layouts.rows[0] || null,
    assignmentPolicies: policies.rows,
  };
}
export async function validateLeadInput(
  client,
  context,
  input,
  recordTypeKey = "standard",
) {
  const config = await getLeadConfiguration(client, context, recordTypeKey);
  const errors = [];
  const custom =
    input.customData && typeof input.customData === "object"
      ? input.customData
      : {};
  for (const f of config.fields) {
    const value =
      f.storage === "standard" ? input[f.standard_column] : custom[f.field_key];
    if (
      f.required &&
      (value === null || value === undefined || text(value) === "")
    )
      errors.push({ field: f.field_key, message: `${f.label} is required.` });
    if (value != null && text(value) !== "") {
      if (
        f.data_type === "email" &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(value))
      )
        errors.push({
          field: f.field_key,
          message: `${f.label} must be a valid email.`,
        });
      if (f.data_type === "url") {
        try {
          new URL(text(value));
        } catch {
          errors.push({
            field: f.field_key,
            message: `${f.label} must be a valid URL.`,
          });
        }
      }
      if (f.data_type === "number" || f.data_type === "currency") {
        if (!Number.isFinite(Number(value)))
          errors.push({
            field: f.field_key,
            message: `${f.label} must be numeric.`,
          });
      }
      if (
        f.data_type === "picklist" &&
        Array.isArray(f.options) &&
        !f.options.map(String).includes(String(value))
      )
        errors.push({
          field: f.field_key,
          message: `${f.label} has an invalid option.`,
        });
    }
  }
  for (const rule of config.layout?.validation_rules || []) {
    if (
      rule.when &&
      matches(rule.when, input) &&
      rule.require &&
      !text(input[rule.require])
    )
      errors.push({
        field: rule.require,
        message: rule.message || `${rule.require} is required.`,
      });
  }
  return { valid: errors.length === 0, errors, configuration: config };
}
export async function findLeadDuplicates(
  client,
  context,
  input,
  excludeId = null,
) {
  const e = email(input.email),
    p = phone(input.mobile || input.phone),
    n = normal(
      `${input.firstName || input.first_name || ""}${input.lastName || input.last_name || ""}`,
    ),
    c = normal(input.companyName || input.company_name);
  if (!e && !p && !n) return [];
  const r = await client.query(
    `SELECT id,code,full_name,email,mobile,phone,company_name,status,((CASE WHEN $2<>'' AND normalized_email=$2 THEN 70 ELSE 0 END)+(CASE WHEN $3<>'' AND normalized_phone=$3 THEN 55 ELSE 0 END)+(CASE WHEN $4<>'' AND regexp_replace(lower(coalesce(full_name,'')),'[^a-z0-9]+','','g')=$4 THEN 25 ELSE 0 END)+(CASE WHEN $5<>'' AND regexp_replace(lower(coalesce(company_name,'')),'[^a-z0-9]+','','g')=$5 THEN 15 ELSE 0 END))::int match_score FROM tenant.crm_leads WHERE organization_id=$1 AND status NOT IN ('archived','converted') AND ($6::uuid IS NULL OR id<>$6) AND (($2<>'' AND normalized_email=$2) OR ($3<>'' AND normalized_phone=$3) OR ($4<>'' AND regexp_replace(lower(coalesce(full_name,'')),'[^a-z0-9]+','','g')=$4)) ORDER BY match_score DESC,updated_at DESC LIMIT 25`,
    [context.organizationId, e, p, n, c, excludeId],
  );
  return r.rows;
}
export async function resolveLeadOwner(client, context, input) {
  const r = await client.query(
    `SELECT * FROM tenant.crm_lead_assignment_policies WHERE organization_id=$1 AND status='active' ORDER BY sequence,id FOR UPDATE`,
    [context.organizationId],
  );
  for (const policy of r.rows) {
    if (!matches(policy.criteria, input)) continue;
    if (policy.mode === "fixed") return policy.assignee_user_id;
    if (policy.mode === "round_robin") {
      const members = policy.member_user_ids || [];
      const s = await client.query(
        `INSERT INTO tenant.crm_lead_assignment_state(organization_id,policy_id,next_index) VALUES($1,$2,1) ON CONFLICT(organization_id,policy_id) DO UPDATE SET next_index=tenant.crm_lead_assignment_state.next_index+1,updated_at=now() RETURNING next_index`,
        [context.organizationId, policy.id],
      );
      return (
        members[(Number(s.rows[0].next_index) - 1) % members.length] || null
      );
    }
  }
  return input.ownerUserId || input.owner_user_id || null;
}
