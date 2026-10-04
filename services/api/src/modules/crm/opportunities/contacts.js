// The people on a deal: one primary contact and any number of other
// stakeholders (the CFO who signs, the IT manager who evaluates), each with a
// role. A stakeholder is always a contact of the deal's account. The primary
// contact is also kept on the opportunity itself, where lists and quotations
// read it.
import { CrmError } from "../data-management/errors.js";
import { requireOpportunityPermission } from "./access.js";
import { OPPORTUNITY_CONTACT_ROLES, OPPORTUNITY_PERMISSIONS } from "./constants.js";
import { recordOpportunityHistory } from "./history.js";
import { getOpportunity, lockOpportunity, requireAccountContact, requireUuid } from "./records.js";

const ROLE_CODES = OPPORTUNITY_CONTACT_ROLES.map((role) => role.code);
const ROLE_LABELS = new Map(OPPORTUNITY_CONTACT_ROLES.map((role) => [role.code, role.label]));
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const text = (value) => String(value ?? "").trim();

function role(value) {
  const code = text(value).toLowerCase() || null;
  if (code && !ROLE_CODES.includes(code)) throw new CrmError(400, "Choose a role from the list.", "CRM_OPPORTUNITY_CONTACT_VALIDATION");
  return code;
}

async function listRows(client, context, opportunityId) {
  const { rows } = await client.query(
    `SELECT link.id, link.contact_id, link.role, link.is_primary, link.notes, contact.display_name, contact.designation, contact.email, contact.mobile, contact.status AS contact_status
       FROM tenant.crm_opportunity_contact_roles link
       JOIN tenant.contacts contact ON contact.organization_id = link.organization_id AND contact.id = link.contact_id
      WHERE link.organization_id = $1 AND link.opportunity_id = $2 AND link.status = 'active'
      ORDER BY link.is_primary DESC, lower(contact.display_name)`,
    [context.organizationId, opportunityId],
  );
  return rows.map((row) => ({
    id: row.id, contactId: row.contact_id, name: row.display_name, jobTitle: row.designation, email: row.email, mobile: row.mobile,
    role: row.role, roleLabel: row.role ? ROLE_LABELS.get(row.role) ?? row.role : null, isPrimary: row.is_primary, notes: row.notes,
    isInactive: row.contact_status !== "active",
  }));
}

export async function listOpportunityContacts(client, context, opportunityId) {
  const opportunity = await getOpportunity(client, context, opportunityId);
  return listRows(client, context, opportunity.id);
}

// Exactly one primary: the pointer on the opportunity follows the flagged row.
async function setPrimary(client, context, opportunityId, contactId) {
  // Cleared first, then set: there is never a moment with two primaries.
  await client.query(`UPDATE tenant.crm_opportunity_contact_roles SET is_primary = false, updated_by = $3, updated_at = now()
                       WHERE organization_id = $1 AND opportunity_id = $2 AND is_primary`,
    [context.organizationId, opportunityId, context.userId ?? null]);
  if (contactId)
    await client.query(`UPDATE tenant.crm_opportunity_contact_roles SET is_primary = true, updated_by = $4, updated_at = now()
                         WHERE organization_id = $1 AND opportunity_id = $2 AND contact_id = $3`,
      [context.organizationId, opportunityId, contactId, context.userId ?? null]);
  await client.query(`UPDATE tenant.crm_opportunities SET contact_id = $3, updated_by = $4 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, opportunityId, contactId, context.userId ?? null]);
}

// input: { contactId (required), role?, isPrimary?, notes? }
export async function addOpportunityContact(client, context, opportunityId, input = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.edit, "You do not have permission to edit opportunities.");
  const opportunity = await lockOpportunity(client, context, opportunityId);
  if (opportunity.archived_at) throw new CrmError(409, "Restore this opportunity before changing it.", "CRM_OPPORTUNITY_ARCHIVED");
  const contact = await requireAccountContact(client, context, input.contactId, opportunity.party_id);
  // The first person on a deal is its primary contact.
  const makePrimary = input.isPrimary === true || !opportunity.contact_id;
  await client.query(
    `INSERT INTO tenant.crm_opportunity_contact_roles (organization_id, opportunity_id, contact_id, role, notes, is_primary, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, false, $6, $6)
     ON CONFLICT (organization_id, opportunity_id, contact_id) DO UPDATE SET status = 'active', role = EXCLUDED.role, notes = EXCLUDED.notes, updated_by = $6, updated_at = now()`,
    [context.organizationId, opportunity.id, contact.id, role(input.role), text(input.notes).slice(0, 2000) || null, context.userId ?? null],
  );
  if (makePrimary) await setPrimary(client, context, opportunity.id, contact.id);
  await recordOpportunityHistory(client, context, opportunity.id, "contact_changed", `Contact added: ${contact.display_name}${makePrimary ? " (primary)" : ""}`, { contactId: contact.id });
  return listRows(client, context, opportunity.id);
}

async function lockLink(client, context, opportunityId, linkId) {
  const { rows } = await client.query(
    `SELECT link.*, contact.display_name FROM tenant.crm_opportunity_contact_roles link
       JOIN tenant.contacts contact ON contact.organization_id = link.organization_id AND contact.id = link.contact_id
      WHERE link.organization_id = $1 AND link.opportunity_id = $2 AND link.id = $3 AND link.status = 'active' FOR UPDATE OF link`,
    [context.organizationId, opportunityId, requireUuid(linkId, "Contact")],
  );
  if (!rows[0]) throw new CrmError(404, "This contact is not on the opportunity.", "CRM_OPPORTUNITY_CONTACT_NOT_FOUND");
  return rows[0];
}

// input: { role?, notes?, isPrimary?: true }
export async function updateOpportunityContact(client, context, opportunityId, linkId, input = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.edit, "You do not have permission to edit opportunities.");
  const opportunity = await lockOpportunity(client, context, opportunityId);
  const link = await lockLink(client, context, opportunity.id, linkId);
  await client.query(`UPDATE tenant.crm_opportunity_contact_roles SET role = $3, notes = $4, updated_by = $5, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, link.id, has(input, "role") ? role(input.role) : link.role, has(input, "notes") ? text(input.notes).slice(0, 2000) || null : link.notes, context.userId ?? null]);
  if (input.isPrimary === true && !link.is_primary) {
    await setPrimary(client, context, opportunity.id, link.contact_id);
    await recordOpportunityHistory(client, context, opportunity.id, "contact_changed", `Primary contact: ${link.display_name}`, { contactId: link.contact_id });
  }
  return listRows(client, context, opportunity.id);
}

// Removing the primary contact makes the next stakeholder primary, if there is one.
export async function removeOpportunityContact(client, context, opportunityId, linkId) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.edit, "You do not have permission to edit opportunities.");
  const opportunity = await lockOpportunity(client, context, opportunityId);
  const link = await lockLink(client, context, opportunity.id, linkId);
  await client.query(`UPDATE tenant.crm_opportunity_contact_roles SET status = 'inactive', is_primary = false, updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, link.id, context.userId ?? null]);
  if (link.is_primary) {
    const next = (await listRows(client, context, opportunity.id))[0];
    await setPrimary(client, context, opportunity.id, next?.contactId ?? null);
  }
  await recordOpportunityHistory(client, context, opportunity.id, "contact_changed", `Contact removed: ${link.display_name}`, { contactId: link.contact_id });
  return listRows(client, context, opportunity.id);
}
