// Merging a duplicate contact into the contact that should be kept. The user
// chooses, field by field, which value survives; blank fields on the kept
// contact are filled from the duplicate. Everything that names the duplicate
// — company links, opportunities, activities, tasks, follow-ups, notes,
// files, quotations, orders, support tickets, campaigns — moves to the kept
// contact. The duplicate is archived, never deleted, and an alias remembers
// where it went.
import { recordAccountHistory } from "../accounts/history.js";
import { CrmError } from "../data-management/errors.js";
import { queueOutboxEvent } from "../data-management/outbox.js";
import { requireContactPermission } from "./access.js";
import { CONTACT_PERMISSIONS } from "./constants.js";
import { recordContactHistory } from "./history.js";
import { getContact, lockContact, toContact } from "./records.js";
import { requireUuid } from "./validation.js";

// field -> column. These are the choices offered on the merge screen.
export const CONTACT_MERGE_FIELDS = Object.freeze({
  firstName: "first_name",
  middleName: "middle_name",
  lastName: "last_name",
  displayName: "display_name",
  email: "email",
  secondaryEmail: "secondary_email",
  phone: "phone",
  mobile: "mobile",
  alternatePhone: "alternate_phone",
  preferredContactMethod: "preferred_contact_method",
  description: "description",
  sourceId: "source_id",
  ownerUserId: "owner_user_id",
  teamId: "team_id",
});
// Filled from the duplicate only when the kept contact has none.
const FILL_ONLY_COLUMNS = Object.freeze(["address_line1", "address_line2", "city", "state", "postal_code", "country_code"]);

// Tables whose contact column simply moves to the kept contact.
const SIMPLE_MOVES = Object.freeze([
  ["crm_opportunities", "contact_id"],
  ["crm_leads", "converted_contact_id"],
  ["crm_activities", "related_contact_id"],
  ["crm_communications", "contact_id"],
  ["crm_email_threads", "contact_id"],
  ["crm_calendar_events", "contact_id"],
  ["crm_conversations", "contact_id"],
  ["crm_field_visits", "contact_id"],
  ["crm_consent_events", "contact_id"],
  ["crm_sequence_enrollments", "contact_id"],
  ["crm_activity_attendees", "contact_id"],
  ["crm_communication_participants", "contact_id"],
  ["crm_account_stakeholders", "contact_id"],
  ["crm_buying_committee_members", "contact_id"],
  ["crm_customer_service_events", "contact_id"],
  ["crm_customer_feedback_responses", "contact_id"],
  ["crm_customer_success_milestones", "customer_contact_id"],
  ["sales_quotations", "contact_id"],
  ["sales_orders", "contact_id"],
  ["support_tickets", "contact_id"],
]);

// What moves, counted for the preview.
const MOVABLE = Object.freeze([
  ["companies", "SELECT count(*)::int AS n FROM tenant.crm_contact_account_relationships WHERE organization_id = $1 AND contact_id = $2"],
  ["opportunities", "SELECT count(*)::int AS n FROM tenant.crm_opportunities WHERE organization_id = $1 AND contact_id = $2"],
  ["activities", "SELECT count(*)::int AS n FROM tenant.crm_activities WHERE organization_id = $1 AND ((entity_type = 'contact' AND entity_id = $2) OR related_contact_id = $2)"],
  ["notes", "SELECT count(*)::int AS n FROM tenant.crm_notes WHERE organization_id = $1 AND entity_type = 'contact' AND entity_id = $2"],
  ["attachments", "SELECT count(*)::int AS n FROM public.attachments WHERE organization_id = $1 AND entity_type = 'crm.contact' AND entity_id = $2::text"],
  ["quotations", "SELECT count(*)::int AS n FROM tenant.sales_quotations WHERE organization_id = $1 AND contact_id = $2"],
  ["sales orders", "SELECT count(*)::int AS n FROM tenant.sales_orders WHERE organization_id = $1 AND contact_id = $2"],
  ["support tickets", "SELECT count(*)::int AS n FROM tenant.support_tickets WHERE organization_id = $1 AND contact_id = $2"],
]);

function blockersFor(keep, duplicate) {
  const blockers = [];
  if (keep.status === "archived") blockers.push("The contact to keep is archived. Reactivate it first.");
  if (duplicate.status === "archived") blockers.push("The duplicate is already archived.");
  return blockers;
}

function assertDistinct(keepId, duplicateId) {
  if (requireUuid(keepId, "Contact") === requireUuid(duplicateId, "Contact"))
    throw new CrmError(400, "Choose two different contacts to merge.", "CRM_CONTACT_MERGE_INVALID");
}

export async function previewContactMerge(client, context, keepId, duplicateId) {
  requireContactPermission(context, CONTACT_PERMISSIONS.merge, "You do not have permission to merge contacts.");
  assertDistinct(keepId, duplicateId);
  const keep = await getContact(client, context, keepId);
  const duplicate = await getContact(client, context, duplicateId);
  const moves = {};
  for (const [label, sql] of MOVABLE) moves[label] = (await client.query(sql, [context.organizationId, duplicate.id])).rows[0].n;
  return { keep, duplicate, fields: Object.keys(CONTACT_MERGE_FIELDS), moves, blockers: blockersFor(keep, duplicate) };
}

// input: { keepId, duplicateId, choices: { [field]: "keep" | "duplicate" } }
export async function mergeContacts(client, context, input = {}) {
  requireContactPermission(context, CONTACT_PERMISSIONS.merge, "You do not have permission to merge contacts.");
  const { keepId, duplicateId } = input;
  assertDistinct(keepId, duplicateId);
  // Lock in a stable order so two opposite merges cannot deadlock.
  const locked = {};
  for (const id of [keepId, duplicateId].sort()) locked[id] = await lockContact(client, context, id);
  const keep = locked[keepId];
  const duplicate = locked[duplicateId];
  const blockers = blockersFor(keep, duplicate);
  if (blockers.length) throw new CrmError(409, blockers[0], "CRM_CONTACT_MERGE_BLOCKED", { blockers });

  const organizationId = context.organizationId;
  const choices = input.choices && typeof input.choices === "object" ? input.choices : {};
  const blank = (value) => value === null || value === undefined || value === "";
  const updates = {};
  for (const [field, column] of Object.entries(CONTACT_MERGE_FIELDS)) {
    const takeDuplicate = choices[field] === "duplicate" || (choices[field] !== "keep" && blank(keep[column]));
    if (takeDuplicate && !blank(duplicate[column]) && String(duplicate[column]) !== String(keep[column] ?? "")) updates[column] = duplicate[column];
  }
  for (const column of FILL_ONLY_COLUMNS) if (blank(keep[column]) && !blank(duplicate[column])) updates[column] = duplicate[column];

  // The duplicate is archived first so it no longer shows as a match.
  await client.query(
    `UPDATE tenant.contacts SET status = 'archived', archived_at = now(), archived_by = $3, updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [organizationId, duplicate.id, context.userId ?? null],
  );
  const move = [organizationId, duplicate.id, keep.id];

  // Company links: a company both are linked to keeps the kept person's link
  // — made current again if only the duplicate's link was, and taking over
  // the account's primary-contact flag if only the duplicate had it; every
  // other link moves, never becoming a second primary company.
  await client.query(
    `UPDATE tenant.crm_contact_account_relationships keep_link
        SET status = 'active', ended_at = NULL, job_title = COALESCE(dup_link.job_title, keep_link.job_title),
            department = COALESCE(dup_link.department, keep_link.department), role = COALESCE(dup_link.role, keep_link.role)
       FROM tenant.crm_contact_account_relationships dup_link
      WHERE keep_link.organization_id = $1 AND keep_link.contact_id = $3 AND dup_link.organization_id = $1 AND dup_link.contact_id = $2
        AND dup_link.party_id = keep_link.party_id AND dup_link.status = 'active' AND keep_link.status = 'inactive'`,
    move,
  );
  await client.query(
    `UPDATE tenant.crm_contact_account_relationships keep_link SET is_primary_contact = true
       FROM tenant.crm_contact_account_relationships dup_link
      WHERE keep_link.organization_id = $1 AND keep_link.contact_id = $3 AND dup_link.organization_id = $1 AND dup_link.contact_id = $2
        AND dup_link.party_id = keep_link.party_id AND dup_link.is_primary_contact AND keep_link.status = 'active'`,
    move,
  );
  await client.query(
    `DELETE FROM tenant.crm_contact_account_relationships dup_link USING tenant.crm_contact_account_relationships keep_link
      WHERE dup_link.organization_id = $1 AND dup_link.contact_id = $2 AND keep_link.organization_id = $1 AND keep_link.contact_id = $3 AND keep_link.party_id = dup_link.party_id`,
    move,
  );
  const keepHasPrimary = (await client.query(`SELECT 1 FROM tenant.crm_contact_account_relationships WHERE organization_id = $1 AND contact_id = $2 AND is_primary_account`,
    [organizationId, keep.id])).rows[0];
  await client.query(
    `UPDATE tenant.crm_contact_account_relationships SET contact_id = $3${keepHasPrimary ? ", is_primary_account = false" : ""} WHERE organization_id = $1 AND contact_id = $2`,
    move,
  );

  // Opportunity roles and campaign memberships are unique per person.
  await client.query(
    `DELETE FROM tenant.crm_opportunity_contact_roles dup_role USING tenant.crm_opportunity_contact_roles keep_role
      WHERE dup_role.organization_id = $1 AND dup_role.contact_id = $2 AND keep_role.organization_id = $1 AND keep_role.contact_id = $3
        AND keep_role.opportunity_id = dup_role.opportunity_id`,
    move,
  );
  await client.query(`UPDATE tenant.crm_opportunity_contact_roles SET contact_id = $3 WHERE organization_id = $1 AND contact_id = $2`, move);
  await client.query(
    `DELETE FROM tenant.crm_campaign_members dup_member USING tenant.crm_campaign_members keep_member
      WHERE dup_member.organization_id = $1 AND dup_member.contact_id = $2 AND keep_member.organization_id = $1 AND keep_member.contact_id = $3
        AND keep_member.campaign_id = dup_member.campaign_id`,
    move,
  );
  await client.query(`UPDATE tenant.crm_campaign_members SET contact_id = $3 WHERE organization_id = $1 AND contact_id = $2`, move);
  for (const [table, column] of SIMPLE_MOVES)
    await client.query(`UPDATE tenant.${table} SET ${column} = $3 WHERE organization_id = $1 AND ${column} = $2`, move);
  await client.query(`UPDATE tenant.crm_activities SET entity_id = $3 WHERE organization_id = $1 AND entity_type = 'contact' AND entity_id = $2`, move);
  await client.query(`UPDATE tenant.crm_notes SET entity_id = $3 WHERE organization_id = $1 AND entity_type = 'contact' AND entity_id = $2`, move);
  await client.query(`UPDATE public.attachments SET entity_id = $3::text WHERE organization_id = $1 AND entity_type = 'crm.contact' AND entity_id = $2::text`, move);
  await client.query(
    `INSERT INTO tenant.crm_contact_tags (organization_id, contact_id, tag_id, created_by)
     SELECT organization_id, $3, tag_id, created_by FROM tenant.crm_contact_tags WHERE organization_id = $1 AND contact_id = $2 ON CONFLICT DO NOTHING`,
    move,
  );
  await client.query(`DELETE FROM tenant.crm_contact_tags WHERE organization_id = $1 AND contact_id = $2`, [organizationId, duplicate.id]);
  // Old links to the duplicate (and to anything already merged into it) now open the kept contact.
  await client.query(`UPDATE tenant.crm_entity_merge_aliases SET survivor_entity_id = $3 WHERE organization_id = $1 AND entity_type = 'contact' AND survivor_entity_id = $2`, move);
  await client.query(
    `INSERT INTO tenant.crm_entity_merge_aliases (organization_id, entity_type, source_entity_id, survivor_entity_id, merged_by)
     VALUES ($1, 'contact', $2, $3, $4)
     ON CONFLICT (organization_id, entity_type, source_entity_id) DO UPDATE SET survivor_entity_id = EXCLUDED.survivor_entity_id, merged_by = EXCLUDED.merged_by, merged_at = now()`,
    [organizationId, duplicate.id, keep.id, context.userId ?? null],
  );

  const columns = Object.keys(updates);
  await client.query(
    `UPDATE tenant.contacts SET ${columns.map((column, index) => `${column} = $${index + 4}, `).join("")}
            last_activity_at = GREATEST(last_activity_at, $3::timestamptz), updated_by = $${columns.length + 4}, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, keep.id, duplicate.last_activity_at, ...columns.map((column) => updates[column]), context.userId ?? null],
  );

  const before = toContact(keep);
  const changes = Object.fromEntries(Object.entries(CONTACT_MERGE_FIELDS).filter(([, column]) => column in updates).map(([field, column]) => [field, { from: before[field] ?? null, to: updates[column] }]));
  const keepName = before.displayName;
  const duplicateName = toContact(duplicate).displayName;
  await recordContactHistory(client, context, duplicate.id, "merged", `Merged into ${keepName} (${keep.contact_number ?? ""})`, { mergedInto: keep.id });
  await recordContactHistory(client, context, keep.id, "merged", `${duplicateName} (${duplicate.contact_number ?? ""}) merged into this contact`, { mergedFrom: duplicate.id, changes });
  if (keep.party_id) await recordAccountHistory(client, context, keep.party_id, "updated", `Contact ${duplicateName} merged into ${keepName}`, { contactId: keep.id, mergedFrom: duplicate.id });
  await queueOutboxEvent(client, context, "crm.contacts.merged", "contact", keep.id, { contactId: keep.id, mergedContactId: duplicate.id });
  return { keptContactId: keep.id, mergedContactId: duplicate.id };
}
