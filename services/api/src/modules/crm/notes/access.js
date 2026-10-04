// Who may read and write notes and files, and on which records.
//
// A note or file belongs to one lead, account, contact or opportunity, and
// is seen only by someone who can see that record — including when the
// record is archived or the lead converted. Its id alone never opens it.
import { CrmError } from "../data-management/errors.js";
import { taskRelatedScopeSql } from "../tasks/access.js";

export const NOTE_PERMISSIONS = Object.freeze({
  view: "crm.notes.view",
  create: "crm.notes.create",
  editOwn: "crm.notes.edit_own",
  editAll: "crm.notes.edit_all",
  deleteOwn: "crm.notes.delete_own",
  deleteAll: "crm.notes.delete_all",
  pin: "crm.notes.pin",
});
export const ATTACHMENT_PERMISSIONS = Object.freeze({
  view: "crm.attachments.view",
  upload: "crm.attachments.upload",
  download: "crm.attachments.download",
  delete: "crm.attachments.delete",
});

export const RECORD_TYPES = Object.freeze(["lead", "party", "contact", "opportunity"]);
const TABLES = Object.freeze({ lead: "tenant.crm_leads", party: "tenant.business_parties", contact: "tenant.contacts", opportunity: "tenant.crm_opportunities" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isOwner = (context) => Boolean(context.roleSlugs?.includes("organization_owner"));
const holds = (context, permission) => Boolean(context.permissions?.includes(permission));
// Older roles: whoever could log CRM work kept notes and files.
const LEGACY = new Set([NOTE_PERMISSIONS.view, NOTE_PERMISSIONS.create, NOTE_PERMISSIONS.editOwn, NOTE_PERMISSIONS.deleteOwn, NOTE_PERMISSIONS.pin,
  ATTACHMENT_PERMISSIONS.view, ATTACHMENT_PERMISSIONS.upload, ATTACHMENT_PERMISSIONS.download]);
const READ = new Set([NOTE_PERMISSIONS.view, ATTACHMENT_PERMISSIONS.view, ATTACHMENT_PERMISSIONS.download]);

export function contentCan(context, permission) {
  if (isOwner(context) || holds(context, permission)) return true;
  if (READ.has(permission) && holds(context, "crm.view")) return true;
  return LEGACY.has(permission) && holds(context, "crm.activities.manage");
}

export function requireContentPermission(context, permission, message = "You do not have permission to do this.") {
  if (!contentCan(context, permission)) throw new CrmError(403, message, "PERMISSION_DENIED");
}

// A private note is seen by its author, the organization owner and CRM administrators.
export function canSeePrivateNotes(context) {
  return isOwner(context) || (holds(context, "crm.records.view_all") && holds(context, "crm.settings.manage"));
}

// The record must exist in this organization and be visible to the caller. Returns false otherwise.
export async function recordVisible(client, context, type, id) {
  if (!RECORD_TYPES.includes(type) || !UUID.test(String(id ?? ""))) return false;
  const values = [context.organizationId, id];
  const scope = taskRelatedScopeSql(context, values, "record_ref");
  const { rows } = await client.query(
    `SELECT 1 FROM ${TABLES[type]} owner_row
       JOIN LATERAL (SELECT owner_row.organization_id, owner_row.id AS entity_id, '${type}'::text AS entity_type) record_ref ON true
      WHERE owner_row.organization_id = $1 AND owner_row.id = $2${scope}`,
    values,
  );
  return Boolean(rows[0]);
}

export async function requireRecordVisible(client, context, type, id) {
  if (!RECORD_TYPES.includes(type)) throw new CrmError(400, "Notes and files belong to a lead, account, contact or opportunity.", "CRM_CONTENT_RECORD_INVALID");
  if (!(await recordVisible(client, context, type, id))) throw new CrmError(404, "The record was not found, or you do not have access to it.", "CRM_CONTENT_RECORD_INVALID");
}

// An opportunity converted from a lead shows the lead's notes and files, read-only, from the lead.
export async function convertedFromLead(client, context, type, id) {
  if (type !== "opportunity") return null;
  const { rows } = await client.query(
    `SELECT lead.id, lead.code FROM tenant.crm_opportunities opportunity JOIN tenant.crm_leads lead ON lead.organization_id = opportunity.organization_id AND lead.id = opportunity.lead_id
      WHERE opportunity.organization_id = $1 AND opportunity.id = $2`,
    [context.organizationId, id],
  );
  if (!rows[0] || !(await recordVisible(client, context, "lead", rows[0].id))) return null;
  return { id: rows[0].id, code: rows[0].code };
}

export async function recordContentHistory(client, context, { entityType, entityId, subjectType, subjectId, eventType, summary, changes = {} }) {
  await client.query(
    `INSERT INTO tenant.crm_content_history (organization_id, entity_type, entity_id, subject_type, subject_id, event_type, summary, changes, actor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
    [context.organizationId, entityType, entityId, subjectType, subjectId, eventType, String(summary).slice(0, 500), JSON.stringify(changes), context.userId ?? null],
  );
}
