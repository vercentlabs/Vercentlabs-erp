// Account ownership: assign, reassign, team assignment and bulk assignment.
// Giving an unowned account its first owner or team needs crm.accounts.assign;
// moving an existing owner or team needs crm.accounts.reassign. The caller
// can only hand an account to people they may assign to (themselves, their
// team, or anyone for view-all holders).
import { createNotification } from "../../../core/platform/notifications/index.js";
import { assertCrmOwnerAssignable } from "../data-management/crm-access-scope.js";
import { CrmError } from "../data-management/errors.js";
import { assertEligibleLeadAssignee as assertEligibleMember } from "../leads/assignment.js";
import { accountScopeSql, requireAccountPermission } from "./access.js";
import { ACCOUNT_PERMISSIONS, CRM_ACCOUNT_PARTY_SQL } from "./constants.js";
import { recordAccountHistory } from "./history.js";
import { requireUuid } from "./validation.js";

const BULK_LIMIT = 200;
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

async function activeTeam(client, context, teamId) {
  const { rows } = await client.query(`SELECT id, name FROM tenant.crm_sales_teams WHERE organization_id = $1 AND id = $2 AND status = 'active'`,
    [context.organizationId, requireUuid(teamId, "Team")]);
  if (!rows[0]) throw new CrmError(409, "Choose an active sales team.", "CRM_ACCOUNT_TEAM_INVALID");
  return rows[0];
}

// Applies an ownership change to an account row already locked (or just
// created) by the caller. `target` holds only the keys being changed.
export async function applyAccountAssignment(client, context, account, target, { reason = "manual", notify = true } = {}) {
  const ownerChanging = has(target, "ownerUserId") && (target.ownerUserId || null) !== (account.owner_user_id || null);
  const teamChanging = has(target, "teamId") && (target.teamId || null) !== (account.team_id || null);
  if (!ownerChanging && !teamChanging) return false;
  const newOwner = ownerChanging && target.ownerUserId ? await assertEligibleMember(client, context, target.ownerUserId) : null;
  const newTeam = teamChanging && target.teamId ? await activeTeam(client, context, target.teamId) : null;
  const ownerUserId = ownerChanging ? newOwner?.id ?? null : account.owner_user_id;
  const teamId = teamChanging ? newTeam?.id ?? null : account.team_id;
  await client.query(
    `UPDATE tenant.business_parties SET owner_user_id = $3, team_id = $4,
            assigned_at = CASE WHEN $5 THEN (CASE WHEN $3::uuid IS NULL THEN NULL ELSE now() END) ELSE assigned_at END,
            updated_by = $6, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, account.id, ownerUserId, teamId, ownerChanging, context.userId ?? null],
  );
  if (ownerChanging) {
    const previous = account.owner_user_id
      ? (await client.query(`SELECT full_name FROM users WHERE id = $1`, [account.owner_user_id])).rows[0]?.full_name ?? "Unknown" : "Unassigned";
    await recordAccountHistory(client, context, account.id, "owner_changed", `Owner: ${previous} → ${newOwner?.full_name ?? "Unassigned"}`,
      { from: account.owner_user_id, to: ownerUserId, reason });
    if (notify && ownerUserId && ownerUserId !== context.userId)
      await createNotification(client, {
        organizationId: context.organizationId,
        userId: ownerUserId,
        category: "crm_account_assignment",
        title: account.owner_user_id ? "Account reassigned to you" : "Account assigned to you",
        message: `${account.display_name} (${account.code}) is now yours.`,
        href: `/crm/accounts/${account.id}`,
        entityType: "account",
        entityId: account.id,
      });
  }
  if (teamChanging) {
    const previous = account.team_id
      ? (await client.query(`SELECT name FROM tenant.crm_sales_teams WHERE organization_id = $1 AND id = $2`, [context.organizationId, account.team_id])).rows[0]?.name ?? "Unknown"
      : "No team";
    await recordAccountHistory(client, context, account.id, "team_changed", `Team: ${previous} → ${newTeam?.name ?? "No team"}`, { from: account.team_id, to: teamId, reason });
  }
  return true;
}

// input: { ownerUserId?: uuid | null, teamId?: uuid | null } — an absent key
// is left unchanged; null clears it.
export async function assignAccount(client, context, partyId, input = {}) {
  if (!has(input, "ownerUserId") && !has(input, "teamId")) throw new CrmError(400, "Choose an owner or a team.", "CRM_ACCOUNT_VALIDATION");
  const values = [context.organizationId, requireUuid(partyId, "Account")];
  const { rows } = await client.query(
    `SELECT account.* FROM tenant.business_parties account
      WHERE account.organization_id = $1 AND account.id = $2 AND ${CRM_ACCOUNT_PARTY_SQL("account")}${accountScopeSql(context, values, "account")}
      FOR UPDATE OF account`,
    values,
  );
  const account = rows[0];
  if (!account) throw new CrmError(404, "Account not found.", "CRM_ACCOUNT_NOT_FOUND");
  if (account.status === "archived") throw new CrmError(409, "Reactivate this account before reassigning it.", "CRM_ACCOUNT_ARCHIVED");
  const target = {};
  if (has(input, "ownerUserId")) target.ownerUserId = input.ownerUserId || null;
  if (has(input, "teamId")) target.teamId = input.teamId || null;
  const ownerChanging = has(target, "ownerUserId") && target.ownerUserId !== account.owner_user_id;
  const teamChanging = has(target, "teamId") && target.teamId !== account.team_id;
  if (!ownerChanging && !teamChanging) return { changed: false };
  const moving = (ownerChanging && account.owner_user_id) || (teamChanging && account.team_id);
  requireAccountPermission(context, moving ? ACCOUNT_PERMISSIONS.reassign : ACCOUNT_PERMISSIONS.assign,
    moving ? "You do not have permission to reassign accounts." : "You do not have permission to assign accounts.");
  if (ownerChanging && target.ownerUserId)
    await assertCrmOwnerAssignable(client, context, target.ownerUserId, "You can only assign accounts to yourself or to members of a team you manage.");
  await applyAccountAssignment(client, context, account, target, { reason: String(input.reason ?? "").trim() || "manual" });
  return { changed: true };
}

export async function bulkAssignAccounts(client, context, input = {}) {
  const ids = [...new Set(Array.isArray(input.partyIds) ? input.partyIds : [])];
  if (!ids.length) throw new CrmError(400, "Select at least one account.", "CRM_ACCOUNT_VALIDATION");
  if (ids.length > BULK_LIMIT) throw new CrmError(400, `Select up to ${BULK_LIMIT} accounts at a time.`, "CRM_ACCOUNT_BULK_LIMIT");
  const results = [];
  for (const partyId of ids) {
    await client.query("SAVEPOINT account_bulk_assign");
    try {
      const outcome = await assignAccount(client, context, partyId, input);
      await client.query("RELEASE SAVEPOINT account_bulk_assign");
      results.push({ partyId, ok: true, changed: outcome.changed });
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT account_bulk_assign");
      if (!(error instanceof CrmError)) throw error;
      results.push({ partyId, ok: false, message: error.message });
    }
  }
  return { results, succeeded: results.filter((entry) => entry.ok).length, failed: results.filter((entry) => !entry.ok).length };
}
