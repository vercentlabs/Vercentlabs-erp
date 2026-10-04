// Merging a duplicate lead into the lead that should be kept. Everything
// recorded against the duplicate (activities, notes, files, tags, emails)
// moves to the kept lead. The user chooses, field by field, which value
// survives; blank fields on the kept lead are filled from the duplicate. The
// duplicate is disqualified as "Duplicate" and archived — never deleted — and
// it remembers the lead it became, so its page points to the kept lead. Its
// own assignment, stage and qualification history stay with it, readable.
import { CrmError } from "../data-management/errors.js";
import { requireLeadPermission } from "./access.js";
import { LEAD_PERMISSIONS } from "./constants.js";
import { recordLeadHistory } from "./history.js";
import { lockLead } from "./records.js";
import { requireUuid } from "./validation.js";

// field -> column: the choices offered on the merge screen. A field not
// chosen keeps the kept lead's value, unless that is blank.
export const LEAD_MERGE_FIELDS = Object.freeze({
  firstName: "first_name", lastName: "last_name", companyName: "company_name", jobTitle: "job_title", email: "email", phone: "phone", mobile: "mobile",
  website: "website", city: "city", state: "state", countryCode: "country_code", sourceId: "source_id", sourceDetail: "source_detail", industry: "industry",
  productInterest: "product_interest", purchaseTimeframe: "purchase_timeframe", description: "description", currencyCode: "currency_code",
});
const FILLABLE_COLUMNS = Object.freeze(Object.values(LEAD_MERGE_FIELDS));
const FIELD_OF_COLUMN = Object.freeze(Object.fromEntries(Object.entries(LEAD_MERGE_FIELDS).map(([field, column]) => [column, field])));
const blank = (value) => value === null || value === undefined || value === "";

// options.choices: { [field]: "keep" | "duplicate" }
export async function mergeLeads(client, context, duplicateLeadId, keepLeadId, { choices = {} } = {}) {
  requireLeadPermission(context, LEAD_PERMISSIONS.merge, "You do not have permission to merge leads.");
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
  await client.query(`UPDATE tenant.crm_attachment_details SET entity_id = $3 WHERE organization_id = $1 AND entity_type = 'lead' AND entity_id = $2`, move);
  await client.query(`UPDATE tenant.crm_communications SET lead_id = $3 WHERE organization_id = $1 AND lead_id = $2`, move);
  await client.query(`UPDATE tenant.crm_email_threads SET lead_id = $3 WHERE organization_id = $1 AND lead_id = $2`, move);
  await client.query(
    `INSERT INTO tenant.crm_lead_tags (organization_id, lead_id, tag_id, created_by)
     SELECT organization_id, $3, tag_id, created_by FROM tenant.crm_lead_tags WHERE organization_id = $1 AND lead_id = $2
     ON CONFLICT DO NOTHING`,
    move,
  );
  await client.query(`DELETE FROM tenant.crm_lead_tags WHERE organization_id = $1 AND lead_id = $2`, [organizationId, duplicate.id]);

  const filled = FILLABLE_COLUMNS.filter((column) => !blank(duplicate[column]) && String(duplicate[column]) !== String(keep[column] ?? "")
    && (choices?.[FIELD_OF_COLUMN[column]] === "duplicate" || (choices?.[FIELD_OF_COLUMN[column]] !== "keep" && blank(keep[column]))));
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
  // Leads merged into the duplicate earlier now point to the kept lead too.
  await client.query(`UPDATE tenant.crm_leads SET merged_into_lead_id = $3 WHERE organization_id = $1 AND (id = $2 OR merged_into_lead_id = $2)`, move);
  const fieldDecisions = Object.fromEntries(filled.map((column) => [FIELD_OF_COLUMN[column], { from: keep[column] ?? null, to: duplicate[column] }]));
  await recordLeadHistory(client, context, duplicate.id, "merged", `Merged into ${keep.code}`, { mergedInto: keep.id });
  await recordLeadHistory(client, context, keep.id, "merged", `Merged ${duplicate.code} into this lead`, { mergedFrom: duplicate.id, filledFields: filled, fieldDecisions });
  return { keptLeadId: keep.id, mergedLeadId: duplicate.id };
}
