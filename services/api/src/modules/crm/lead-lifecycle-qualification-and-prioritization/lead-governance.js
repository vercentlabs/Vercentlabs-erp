// F005 Lead assignment logic moved to
// lead-lifecycle-qualification-and-prioritization/assignment/ as part of
// CRM vNext Prompt 4 — re-exported below for existing call sites (the
// package root re-exports this whole module, star-export style). This
// file now only keeps the Lead-configuration/layout-validation and
// duplicate-check helpers that are NOT F005-specific.
import { evaluateLeadDuplicateRisk } from "../prospect-and-relationship-master-data/lead-duplicates.js";
import { LeadGovernanceError, matches, text } from "./assignment/shared.js";

export * from "./assignment/index.js";
export { LeadGovernanceError };

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
  const evaluation = await evaluateLeadDuplicateRisk(client, context, input, {
    excludeLeadId: excludeId,
    lock: false,
  });
  return evaluation.matches;
}
