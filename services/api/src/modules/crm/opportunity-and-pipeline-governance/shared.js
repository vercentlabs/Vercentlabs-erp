// F009-F012/F026 — shared helpers for the Opportunity-and-pipeline-
// governance capability. Kept in its own file (rather than importing the
// legacy flat crm/index.js from every new file here) so this capability's
// own new modules depend on the legacy tree in one direction only.
import { CrmError } from "../crm-data-operations-and-customization/errors.js";
import { queueOutboxEvent } from "../crm-data-operations-and-customization/outbox.js";
import { resources } from "../crm-data-operations-and-customization/resource-registry.js";
import { recordScope } from "../crm-data-operations-and-customization/record-policy.js";

export { CrmError, queueOutboxEvent, resources, recordScope };

export const text = (value) => String(value ?? "").trim();
export const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
export const camelize = (row) =>
  Object.fromEntries(
    Object.entries(row || {}).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_match, character) => character.toUpperCase()),
      value,
    ]),
  );

// Company/branch/owner record-scoped Opportunity lookup, locked for update.
// Every child-entity write in this capability (items, team members,
// competitors, stage migration) goes through this first — the child table
// itself has no company_id/branch_id of its own to scope by, so the parent
// Opportunity's scope is the only enforcement point.
// F012 gap-closure (benchmark: "Sales stages configuration in top ERPs"
// report) — mirrors lead-lifecycle's own isElevatedLifecycleActor exactly:
// bulk-migrating every open Opportunity off a stage is a destructive,
// wide-blast-radius action, so it requires the same elevated pairing
// (organization owner or crm.records.view_all) as the analogous override
// actions elsewhere, not just the ordinary settings-management permission
// that suffices for routine, non-destructive stage catalogue edits.
export function isElevatedSalesStageActor(context) {
  return Boolean(
    context.roleSlugs?.includes("organization_owner") ||
      context.permissions?.includes("crm.records.view_all"),
  );
}

export async function requireOpportunityInScope(client, context, opportunityId, { lock = true } = {}) {
  const id = text(opportunityId);
  if (!id) throw new CrmError(400, "Choose an Opportunity.", "CRM_OPPORTUNITY_ID_REQUIRED");
  const parameters = [context.organizationId, id];
  const result = await client.query(
    `SELECT record.* FROM tenant.crm_opportunities record WHERE record.organization_id=$1 AND record.id=$2${recordScope(resources.opportunities, context, parameters)}${lock ? " FOR UPDATE" : ""}`,
    parameters,
  );
  if (!result.rows[0]) throw new CrmError(404, "Opportunity not found.", "CRM_OPPORTUNITY_NOT_FOUND");
  return camelize(result.rows[0]);
}
