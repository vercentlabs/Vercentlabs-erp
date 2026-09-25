// F007 Lead lifecycle — shared helpers used across the stage catalogue,
// transition graph, transition engine and stage-migration modules. Moved
// here (from the legacy flat lead-lifecycle.js) as part of CRM vNext
// Prompt 4's directed-transition-graph rebuild; lead-lifecycle.js now
// re-exports this capability directory's public surface for compatibility.
import { crmOwnerScopeSql } from "../../crm-data-operations-and-customization/crm-access-scope.js";
import { CrmError } from "../../crm-data-operations-and-customization/errors.js";
import { queueOutboxEvent } from "../../crm-data-operations-and-customization/outbox.js";
import { canViewSensitiveLeadContent, projectLeadForContext } from "../lead-security.js";

export { CrmError, queueOutboxEvent, canViewSensitiveLeadContent, projectLeadForContext };

export const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const dto = (row) =>
  Object.fromEntries(
    Object.entries(row || {}).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_match, character) => character.toUpperCase()),
      value,
    ]),
  );
export const text = (value) => String(value ?? "").trim();

export function lifecycleError(error) {
  if (error instanceof CrmError) return error;
  if (error?.code === "23505")
    return new CrmError(
      409,
      "A Lead lifecycle stage with that name already exists.",
      "CRM_LEAD_STAGE_DUPLICATE",
      { errors: { name: ["Use a unique stage name."] } },
    );
  if (["23503", "23514", "22P02", "P0001"].includes(error?.code))
    return new CrmError(
      409,
      error?.code === "P0001"
        ? "Use the governed Lead lifecycle transition action."
        : "Review the Lead lifecycle values and try again.",
      "CRM_LEAD_STAGE_VALIDATION_ERROR",
    );
  return error;
}

export function stageSelect() {
  return `SELECT stage.*,
    (SELECT count(*)::int FROM tenant.crm_leads lead
      WHERE lead.organization_id=stage.organization_id AND lead.status=stage.code AND lead.record_status='active') AS lead_count
    FROM tenant.crm_lead_stages stage`;
}

export async function getLeadStage(client, context, idOrCode) {
  const result = await client.query(
    `${stageSelect()} WHERE stage.organization_id=$1
       AND (${UUID_RE.test(String(idOrCode)) ? "stage.id=$2" : "stage.code=$2"}) LIMIT 1`,
    [context.organizationId, idOrCode],
  );
  if (!result.rows[0]) throw new CrmError(404, "Lead lifecycle stage not found.", "CRM_LEAD_STAGE_NOT_FOUND");
  return dto(result.rows[0]);
}

export function scopedLeadWhere(context, values) {
  let sql = "";
  if (context.activeCompanyId) {
    values.push(context.activeCompanyId);
    sql += ` AND (lead.company_id IS NULL OR lead.company_id=$${values.length})`;
  } else if (!context.allowAllCompanies) sql += " AND false";
  if (context.activeBranchId) {
    values.push(context.activeBranchId);
    sql += ` AND (lead.branch_id IS NULL OR lead.branch_id=$${values.length})`;
  }
  sql += crmOwnerScopeSql(context, (value) => { values.push(value); return `$${values.length}`; }, "lead.owner_user_id", "lead.organization_id", { resource: "leads", alias: "lead" });
  return sql;
}

// F005/F007-style elevated check: an ordinary crmSettingsManage admin can
// configure the catalogue/graph, but destructive/exception actions (force
// stage deactivation despite active leads is blocked entirely — no force
// exists; migration and reason-required overrides) additionally require
// the same elevated pairing used by manual Lead assignment/qualification
// override, so a single low-privilege settings permission cannot silently
// gain override authority.
export function isElevatedLifecycleActor(context) {
  return (
    context.roleSlugs?.includes("organization_owner") ||
    context.permissions?.includes("crm.records.view_all")
  );
}
