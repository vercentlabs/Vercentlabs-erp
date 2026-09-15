// F028 Tag assignment — governed assign/remove/list commands over the
// existing tenant.crm_lead_tags junction (002_crm_module.sql). Tag
// DEFINITIONS (tenant.crm_tags) already go through the generic
// resource-mutation-service (see resource-registry.js's "tags" entry);
// this module is the missing piece: assigning a defined tag to an
// actual record. Confirmed by direct search that crm_lead_tags was
// only ever written to by lead-conversion's own tag-copy INSERT
// (crm-conversion-and-sales-handoff/lead-conversion.js) — no
// assign/remove/list command and no UI existed before this file.
//
// Lead-scoped only, deliberately: crm_lead_tags is the ONLY tag
// junction table that exists in the schema (no crm_account_tags /
// crm_contact_tags / crm_opportunity_tags). F028's own dossier
// (F028-DATA-001) names crm_lead_tags specifically as the authoritative
// structure. Extending tag assignment to other entities would require a
// new migration adding new junction tables — a deliberate, separate
// schema decision, not something to improvise here.
import { CrmError } from "./errors.js";
import { queueOutboxEvent } from "./outbox.js";
import { resolveCrmEntityAccess } from "../seller-activity-and-follow-up-workspace/timeline/timeline.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function camelize(key) { return key.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase()); }
function dto(row) { return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [camelize(key), value])); }
function assertUuid(value, label) {
  if (!UUID.test(String(value || ""))) throw new CrmError(400, `${label} is invalid.`, "CRM_TAG_REFERENCE_INVALID");
  return String(value);
}
function assertEntityType(entityType) {
  if (entityType !== "lead") throw new CrmError(400, "Tag assignment is only available on Leads.", "CRM_TAG_ENTITY_INVALID");
}
function assertCanManageTags(context) {
  const allowed =
    Boolean(context.roleSlugs?.includes("organization_owner")) ||
    Boolean(context.permissions?.includes("crm.leads.manage"));
  if (!allowed) throw new CrmError(403, "You do not have permission to manage tags on this record.", "CRM_TAG_PERMISSION_DENIED");
}

export async function listRecordTags(client, context, entityType, entityId) {
  assertEntityType(entityType);
  const allowed = await resolveCrmEntityAccess(client, context, entityType, entityId);
  if (!allowed) return [];
  const result = await client.query(
    `SELECT t.id AS tag_id, t.name, t.color, lt.created_at AS assigned_at
       FROM tenant.crm_lead_tags lt
       JOIN tenant.crm_tags t ON t.organization_id = lt.organization_id AND t.id = lt.tag_id
      WHERE lt.organization_id=$1 AND lt.lead_id=$2
      ORDER BY t.name`,
    [context.organizationId, entityId],
  );
  return result.rows.map(dto);
}

// All-or-nothing per call: one governed record/tag pair per command,
// same convention as setCustomFieldValues's "validate before persist"
// discipline, just with a single relationship instead of a field set.
export async function assignRecordTag(client, context, entityType, entityId, tagId) {
  assertEntityType(entityType);
  assertUuid(entityId, "Record");
  assertUuid(tagId, "Tag");
  assertCanManageTags(context);
  const allowed = await resolveCrmEntityAccess(client, context, entityType, entityId);
  if (!allowed) throw new CrmError(404, "The related CRM record is unavailable.", "CRM_TAG_RELATION_INVALID");

  const tag = (
    await client.query(`SELECT * FROM tenant.crm_tags WHERE organization_id=$1 AND id=$2 AND status='active'`, [context.organizationId, tagId])
  ).rows[0];
  if (!tag) throw new CrmError(404, "Tag not found or inactive.", "CRM_TAG_NOT_FOUND");

  await client.query(
    `INSERT INTO tenant.crm_lead_tags(organization_id, lead_id, tag_id, created_by) VALUES($1,$2,$3,$4)
     ON CONFLICT (organization_id, lead_id, tag_id) DO NOTHING`,
    [context.organizationId, entityId, tagId, context.userId],
  );
  await queueOutboxEvent(client, context, "crm.lead.tag_assigned", entityType, entityId, { tagId, tagName: tag.name });
  return listRecordTags(client, context, entityType, entityId);
}

export async function removeRecordTag(client, context, entityType, entityId, tagId) {
  assertEntityType(entityType);
  assertUuid(entityId, "Record");
  assertUuid(tagId, "Tag");
  assertCanManageTags(context);
  const allowed = await resolveCrmEntityAccess(client, context, entityType, entityId);
  if (!allowed) throw new CrmError(404, "The related CRM record is unavailable.", "CRM_TAG_RELATION_INVALID");

  const result = await client.query(
    `DELETE FROM tenant.crm_lead_tags WHERE organization_id=$1 AND lead_id=$2 AND tag_id=$3 RETURNING tag_id`,
    [context.organizationId, entityId, tagId],
  );
  if (!result.rows[0]) throw new CrmError(404, "That tag is not assigned to this record.", "CRM_TAG_ASSIGNMENT_NOT_FOUND");
  await queueOutboxEvent(client, context, "crm.lead.tag_removed", entityType, entityId, { tagId });
  return listRecordTags(client, context, entityType, entityId);
}
