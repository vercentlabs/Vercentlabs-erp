// Contact ownership: assign, reassign, team assignment and bulk assignment.
// Giving an unowned contact its first owner or team needs crm.contacts.assign;
// moving an existing owner or team needs crm.contacts.reassign. The caller
// can only hand a contact to people they may assign to.
import { createNotification } from "../../../core/platform/notifications/index.js";
import { assertCrmOwnerAssignable } from "../data-management/crm-access-scope.js";
import { CrmError } from "../data-management/errors.js";
import { assertEligibleLeadAssignee as assertEligibleMember } from "../leads/assignment.js";
import { contactScopeValues, requireContactPermission } from "./access.js";
import { CONTACT_PERMISSIONS } from "./constants.js";
import { recordContactHistory } from "./history.js";
import { requireUuid } from "./validation.js";

const BULK_LIMIT = 200;
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const nameOf = (contact) => contact.display_name || `${contact.first_name} ${contact.last_name ?? ""}`.trim();

async function activeTeam(client, context, teamId) {
  const { rows } = await client.query(`SELECT id, name FROM tenant.crm_sales_teams WHERE organization_id = $1 AND id = $2 AND status = 'active'`,
    [context.organizationId, requireUuid(teamId, "Team")]);
  if (!rows[0]) throw new CrmError(409, "Choose an active sales team.", "CRM_CONTACT_TEAM_INVALID");
  return rows[0];
}

// Applies an ownership change to a contact row already locked (or just
// created) by the caller. `target` holds only the keys being changed.
export async function applyContactAssignment(client, context, contact, target, { reason = "manual", notify = true } = {}) {
  const ownerChanging = has(target, "ownerUserId") && (target.ownerUserId || null) !== (contact.owner_user_id || null);
  const teamChanging = has(target, "teamId") && (target.teamId || null) !== (contact.team_id || null);
  if (!ownerChanging && !teamChanging) return false;
  const newOwner = ownerChanging && target.ownerUserId ? await assertEligibleMember(client, context, target.ownerUserId) : null;
  const newTeam = teamChanging && target.teamId ? await activeTeam(client, context, target.teamId) : null;
  const ownerUserId = ownerChanging ? newOwner?.id ?? null : contact.owner_user_id;
  const teamId = teamChanging ? newTeam?.id ?? null : contact.team_id;
  await client.query(
    `UPDATE tenant.contacts SET owner_user_id = $3, team_id = $4,
            assigned_at = CASE WHEN $5 THEN (CASE WHEN $3::uuid IS NULL THEN NULL ELSE now() END) ELSE assigned_at END,
            updated_by = $6, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, contact.id, ownerUserId, teamId, ownerChanging, context.userId ?? null],
  );
  if (ownerChanging) {
    const previous = contact.owner_user_id
      ? (await client.query(`SELECT full_name FROM users WHERE id = $1`, [contact.owner_user_id])).rows[0]?.full_name ?? "Unknown" : "Unassigned";
    await recordContactHistory(client, context, contact.id, "owner_changed", `Owner: ${previous} → ${newOwner?.full_name ?? "Unassigned"}`,
      { from: contact.owner_user_id, to: ownerUserId, reason });
    if (notify && ownerUserId && ownerUserId !== context.userId)
      await createNotification(client, {
        organizationId: context.organizationId,
        userId: ownerUserId,
        category: "crm_contact_assignment",
        title: contact.owner_user_id ? "Contact reassigned to you" : "Contact assigned to you",
        message: `${nameOf(contact)}${contact.contact_number ? ` (${contact.contact_number})` : ""} is now yours.`,
        href: `/crm/contacts/${contact.id}`,
        entityType: "contact",
        entityId: contact.id,
      });
  }
  if (teamChanging) {
    const previous = contact.team_id
      ? (await client.query(`SELECT name FROM tenant.crm_sales_teams WHERE organization_id = $1 AND id = $2`, [context.organizationId, contact.team_id])).rows[0]?.name ?? "Unknown"
      : "No team";
    await recordContactHistory(client, context, contact.id, "team_changed", `Team: ${previous} → ${newTeam?.name ?? "No team"}`, { from: contact.team_id, to: teamId, reason });
  }
  return true;
}

// input: { ownerUserId?: uuid | null, teamId?: uuid | null, reason? } — an
// absent key is left unchanged; null clears it.
export async function assignContact(client, context, contactId, input = {}) {
  if (!has(input, "ownerUserId") && !has(input, "teamId")) throw new CrmError(400, "Choose an owner or a team.", "CRM_CONTACT_VALIDATION");
  const values = [context.organizationId, requireUuid(contactId, "Contact")];
  const { rows } = await client.query(
    `SELECT contact.* FROM tenant.contacts contact WHERE contact.organization_id = $1 AND contact.id = $2${contactScopeValues(context, values, "contact")} FOR UPDATE OF contact`,
    values,
  );
  const contact = rows[0];
  if (!contact) throw new CrmError(404, "Contact not found.", "CRM_CONTACT_NOT_FOUND");
  if (contact.status === "archived") throw new CrmError(409, "Reactivate this contact before reassigning it.", "CRM_CONTACT_ARCHIVED");
  const target = {};
  if (has(input, "ownerUserId")) target.ownerUserId = input.ownerUserId || null;
  if (has(input, "teamId")) target.teamId = input.teamId || null;
  const ownerChanging = has(target, "ownerUserId") && target.ownerUserId !== contact.owner_user_id;
  const teamChanging = has(target, "teamId") && target.teamId !== contact.team_id;
  if (!ownerChanging && !teamChanging) return { changed: false };
  const moving = (ownerChanging && contact.owner_user_id) || (teamChanging && contact.team_id);
  requireContactPermission(context, moving ? CONTACT_PERMISSIONS.reassign : CONTACT_PERMISSIONS.assign,
    moving ? "You do not have permission to reassign contacts." : "You do not have permission to assign contacts.");
  if (ownerChanging && target.ownerUserId)
    await assertCrmOwnerAssignable(client, context, target.ownerUserId, "You can only assign contacts to yourself or to members of a team you manage.");
  await applyContactAssignment(client, context, contact, target, { reason: String(input.reason ?? "").trim() || "manual" });
  return { changed: true };
}

export const reassignContact = assignContact;

export async function bulkAssignContacts(client, context, input = {}) {
  const ids = [...new Set(Array.isArray(input.contactIds) ? input.contactIds : [])];
  if (!ids.length) throw new CrmError(400, "Select at least one contact.", "CRM_CONTACT_VALIDATION");
  if (ids.length > BULK_LIMIT) throw new CrmError(400, `Select up to ${BULK_LIMIT} contacts at a time.`, "CRM_CONTACT_BULK_LIMIT");
  const results = [];
  for (const contactId of ids) {
    await client.query("SAVEPOINT contact_bulk_assign");
    try {
      const outcome = await assignContact(client, context, contactId, input);
      await client.query("RELEASE SAVEPOINT contact_bulk_assign");
      results.push({ contactId, ok: true, changed: outcome.changed });
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT contact_bulk_assign");
      if (!(error instanceof CrmError)) throw error;
      results.push({ contactId, ok: false, message: error.message });
    }
  }
  return { results, succeeded: results.filter((entry) => entry.ok).length, failed: results.filter((entry) => !entry.ok).length };
}
