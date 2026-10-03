// Merging a duplicate lead into the lead that should be kept. Everything
// recorded against the duplicate (activities, notes, files, tags, emails)
// moves to the kept lead, blank fields on the kept lead are filled from the
// duplicate, and the duplicate is disqualified as "Duplicate" and archived —
// never deleted, so its history survives.
import { CrmError } from "../data-management/errors.js";
import { requireLeadPermission } from "./access.js";
import { LEAD_PERMISSIONS } from "./constants.js";
import { recordLeadHistory } from "./history.js";
import { lockLead } from "./records.js";
import { requireUuid } from "./validation.js";

// Copied from the duplicate only where the kept lead has no value.
const FILLABLE_COLUMNS = Object.freeze([
  "first_name", "last_name", "company_name", "job_title", "email", "phone", "mobile", "website", "city", "state", "country_code",
  "source_id", "source_detail", "industry", "product_interest", "purchase_timeframe", "description", "currency_code",
]);

export async function mergeLeads(client, context, duplicateLeadId, keepLeadId) {
  requireLeadPermission(context, LEAD_PERMISSIONS.edit, "You do not have permission to merge leads.");
  requireLeadPermission(context, LEAD_PERMISSIONS.disqualify, "You do not have permission to merge leads.");
  if (requireUuid(duplicateLeadId, "Lead") === requireUuid(keepLeadId, "Lead"))
    throw new CrmError(400, "Choose two different leads to merge.", "CRM_LEAD_MERGE_INVALID");
  // Lock in a stable order so two opposite merges cannot deadlock.
  const [firstId, secondId] = [duplicateLeadId, keepLeadId].sort();
  const first = await lockLead(client, context, firstId);
  const second = await lockLead(client, context, secondId);
  const duplicate = first.id === duplicateLeadId ? first : second;
  const keep = first.id === keepLeadId ? first : second;
  for (const lead of [duplicate, keep])
    if (lead.status === "converted") throw new CrmError(409, "A converted lead cannot be merged.", "CRM_LEAD_CONVERTED");

  const organizationId = context.organizationId;
  const move = [organizationId, duplicate.id, keep.id];
  await client.query(`UPDATE tenant.crm_activities SET entity_id = $3 WHERE organization_id = $1 AND entity_type = 'lead' AND entity_id = $2`, move);
  await client.query(`UPDATE tenant.crm_notes SET entity_id = $3 WHERE organization_id = $1 AND entity_type = 'lead' AND entity_id = $2`, move);
  await client.query(`UPDATE public.attachments SET entity_id = $3::text WHERE organization_id = $1 AND entity_type = 'crm.lead' AND entity_id = $2::text`, move);
  await client.query(`UPDATE tenant.crm_communications SET lead_id = $3 WHERE organization_id = $1 AND lead_id = $2`, move);
  await client.query(`UPDATE tenant.crm_email_threads SET lead_id = $3 WHERE organization_id = $1 AND lead_id = $2`, move);
  await client.query(
    `INSERT INTO tenant.crm_lead_tags (organization_id, lead_id, tag_id, created_by)
     SELECT organization_id, $3, tag_id, created_by FROM tenant.crm_lead_tags WHERE organization_id = $1 AND lead_id = $2
     ON CONFLICT DO NOTHING`,
    move,
  );
  await client.query(`DELETE FROM tenant.crm_lead_tags WHERE organization_id = $1 AND lead_id = $2`, [organizationId, duplicate.id]);

  const filled = FILLABLE_COLUMNS.filter((column) => (keep[column] === null || keep[column] === "") && duplicate[column] !== null && duplicate[column] !== "");
  // The duplicate gives up its identity first so the kept lead can take its
  // email or phone without the two colliding in duplicate detection.
  await client.query(
    `UPDATE tenant.crm_leads SET status = 'disqualified', disqualification_reason = 'duplicate', disqualification_notes = $3,
            disqualified_at = now(), disqualified_by = $4, qualified_at = NULL, qualified_by = NULL,
            archived_at = now(), archived_by = $4, updated_by = $4
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, duplicate.id, `Merged into ${keep.code}`, context.userId ?? null],
  );
  if (filled.length) {
    await client.query(
      `UPDATE tenant.crm_leads SET ${filled.map((column, index) => `${column} = $${index + 3}`).join(", ")},
              last_activity_at = GREATEST(last_activity_at, $${filled.length + 3}::timestamptz), updated_by = $${filled.length + 4}
        WHERE organization_id = $1 AND id = $2`,
      [organizationId, keep.id, ...filled.map((column) => duplicate[column]), duplicate.last_activity_at, context.userId ?? null],
    );
  }
  await recordLeadHistory(client, context, duplicate.id, "merged", `Merged into ${keep.code}`, { mergedInto: keep.id });
  await recordLeadHistory(client, context, keep.id, "merged", `Merged ${duplicate.code} into this lead`, { mergedFrom: duplicate.id, filledFields: filled });
  return { keptLeadId: keep.id, mergedLeadId: duplicate.id };
}
