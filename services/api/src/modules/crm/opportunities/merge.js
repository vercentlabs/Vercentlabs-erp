// Merging two deals of the same company (CRM plan 5.4). Everything recorded against the duplicate moves to the deal that is kept —
// activities and follow-ups, notes, files, emails, WhatsApp, calls and SMS, products, contacts and their roles, tags, followers and
// quotations — and the person chooses, field by field, which value survives (blank fields on the kept deal are filled from the
// duplicate). The duplicate is then closed as lost with the reason "Duplicate deal", pointing at the kept deal: never deleted, its own
// stage, assignment and close history stay readable. A duplicate that already became a sales order cannot be merged away.
import { CrmError } from "../data-management/errors.js";
import { moveRecordedHistory } from "../data-management/merge-history.js";
import { requireOpportunityPermission } from "./access.js";
import { OPPORTUNITY_PERMISSIONS } from "./constants.js";
import { recordOpportunityHistory } from "./history.js";
import { assertOpen, getOpportunity, lockOpportunity, requireUuid } from "./records.js";

// field -> column: the choices offered on the merge screen.
export const OPPORTUNITY_MERGE_FIELDS = Object.freeze({
  name: "name", amount: "amount", expectedCloseDate: "expected_close_date", priority: "priority", sourceId: "source_id", campaignId: "campaign_id",
  medium: "medium", productInterest: "product_interest", description: "description", businessProblem: "business_problem", requirements: "requirements",
  proposedSolution: "proposed_solution", commercialNotes: "commercial_notes", nextStep: "next_step",
});
const FIELD_OF_COLUMN = Object.freeze(Object.fromEntries(Object.entries(OPPORTUNITY_MERGE_FIELDS).map(([field, column]) => [column, field])));
const blank = (value) => value === null || value === undefined || value === "" || (typeof value === "string" && !value.trim());
// amount 0 counts as blank (no estimate yet)
const isBlank = (column, value) => blank(value) || (column === "amount" && Number(value) === 0);

// input: { keepId, duplicateId, choices?: { [field]: "keep" | "duplicate" }, notes? }
export async function mergeOpportunities(client, context, input = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.edit, "You do not have permission to merge deals.");
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.markLost, "You do not have permission to merge deals.");
  const keepId = requireUuid(input.keepId, "Deal");
  const duplicateId = requireUuid(input.duplicateId, "Deal");
  if (keepId === duplicateId) throw new CrmError(400, "Choose two different deals to merge.", "CRM_OPPORTUNITY_MERGE_INVALID");
  // Lock in a stable order so two opposite merges cannot deadlock.
  const [firstId, secondId] = [keepId, duplicateId].sort();
  const first = await lockOpportunity(client, context, firstId);
  const second = await lockOpportunity(client, context, secondId);
  const keep = first.id === keepId ? first : second;
  const duplicate = first.id === duplicateId ? first : second;
  assertOpen(keep, "merged");
  assertOpen(duplicate, "merged");
  if (keep.party_id !== duplicate.party_id) throw new CrmError(409, "Only deals of the same company can be merged.", "CRM_OPPORTUNITY_MERGE_ACCOUNT");
  const organizationId = context.organizationId;
  const ordered = (await client.query("SELECT sales_order_number FROM tenant.sales_orders WHERE organization_id = $1 AND source_opportunity_id = $2 LIMIT 1", [organizationId, duplicate.id])).rows[0];
  if (ordered) throw new CrmError(409, `${duplicate.code} already became sales order ${ordered.sales_order_number}. Keep that deal instead.`, "CRM_OPPORTUNITY_MERGE_ORDERED");
  // The lost reason that marks a duplicate (the standard "Duplicate deal", or the organization's own that links a duplicate).
  const { listCloseReasons } = await import("../close-reasons/records.js");
  await listCloseReasons(client, context, { outcome: "lost" });
  const duplicateReason = (await client.query(
    `SELECT id FROM tenant.crm_lost_reasons WHERE organization_id = $1 AND outcome_type = 'lost' AND links_duplicate AND status = 'active' ORDER BY (code = 'duplicate_opportunity') DESC, sequence LIMIT 1`,
    [organizationId])).rows[0];
  if (!duplicateReason) throw new CrmError(409, "Switch on the lost reason \"Duplicate deal\" to merge deals.", "CRM_OPPORTUNITY_MERGE_REASON");

  // What was recorded against the duplicate moves.
  const move = [organizationId, duplicate.id, keep.id];
  await moveRecordedHistory(client, context, "opportunity", duplicate.id, keep.id);
  await client.query("UPDATE tenant.crm_opportunity_items SET opportunity_id = $3 WHERE organization_id = $1 AND opportunity_id = $2", move);
  await client.query("UPDATE tenant.sales_quotations SET source_opportunity_id = $3 WHERE organization_id = $1 AND source_opportunity_id = $2", move);
  await client.query(
    `INSERT INTO tenant.crm_opportunity_contact_roles (organization_id, opportunity_id, contact_id, role, is_primary, status, created_by, updated_by)
     SELECT organization_id, $3, contact_id, role, false, status, $4, $4 FROM tenant.crm_opportunity_contact_roles WHERE organization_id = $1 AND opportunity_id = $2 AND status = 'active'
     ON CONFLICT (organization_id, opportunity_id, contact_id) DO NOTHING`, [...move, context.userId ?? null]);

  // The fields: the duplicate's value where chosen, or where the kept deal has none.
  const choices = input.choices ?? {};
  const filled = Object.values(OPPORTUNITY_MERGE_FIELDS).filter((column) => !isBlank(column, duplicate[column]) && String(duplicate[column]) !== String(keep[column] ?? "")
    && (choices[FIELD_OF_COLUMN[column]] === "duplicate" || (choices[FIELD_OF_COLUMN[column]] !== "keep" && isBlank(column, keep[column]))));
  const custom = { ...(duplicate.custom_data ?? {}), ...Object.fromEntries(Object.entries(keep.custom_data ?? {}).filter(([, value]) => !blank(value))) };
  const recurring = !keep.recurring_plan_id && duplicate.recurring_plan_id ? { recurring_plan_id: duplicate.recurring_plan_id, recurring_revenue: duplicate.recurring_revenue } : {};
  const sets = { ...Object.fromEntries(filled.map((column) => [column, duplicate[column]])), ...recurring };
  const columns = Object.keys(sets);
  await client.query(
    `UPDATE tenant.crm_opportunities SET custom_data = $3::jsonb, last_activity_at = GREATEST(last_activity_at, $4::timestamptz), updated_by = $5
       ${columns.map((column, index) => `, ${column} = $${index + 6}`).join("")}
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, keep.id, JSON.stringify(custom), duplicate.last_activity_at, context.userId ?? null, ...columns.map((column) => sets[column])]);

  // The duplicate closes as lost, as a duplicate of the kept deal (its page links to the kept one).
  const { markOpportunityLost } = await import("./outcome.js");
  const fresh = await getOpportunity(client, context, duplicate.id);
  await markOpportunityLost(client, context, duplicate.id, {
    reasonId: duplicateReason.id, duplicateOfOpportunityId: keep.id, notes: `Merged into ${keep.code}${input.notes ? `: ${String(input.notes).slice(0, 500)}` : ""}`,
    expectedUpdatedAt: fresh.updatedAt, openTasks: "keep", openFollowUps: "keep",
  });
  const fieldDecisions = Object.fromEntries(filled.map((column) => [FIELD_OF_COLUMN[column], { from: keep[column] ?? null, to: duplicate[column] }]));
  await recordOpportunityHistory(client, context, keep.id, "updated", `Merged ${duplicate.code} (${duplicate.name}) into this deal`, { mergedFrom: duplicate.id, filledFields: filled, fieldDecisions });
  return { keptOpportunityId: keep.id, mergedOpportunityId: duplicate.id, filledFields: filled.map((column) => FIELD_OF_COLUMN[column]) };
}
