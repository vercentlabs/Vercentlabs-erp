// Simple parent -> child company structure. An account has at most one
// parent, and the chain can never loop back on itself.
import { CrmError } from "../data-management/errors.js";
import { accountScopeSql, requireAccountPermission } from "./access.js";
import { ACCOUNT_PERMISSIONS, CRM_ACCOUNT_PARTY_SQL } from "./constants.js";
import { recordAccountHistory } from "./history.js";
import { getAccount, lockAccount } from "./records.js";
import { requireUuid } from "./validation.js";

export async function setAccountParent(client, context, partyId, input = {}) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.edit, "You do not have permission to edit accounts.");
  const account = await lockAccount(client, context, partyId);
  const parentId = input.parentPartyId ? requireUuid(input.parentPartyId, "Parent account") : null;
  if ((account.parent_party_id || null) === parentId) return { changed: false };
  let parent = null;
  if (parentId) {
    if (parentId === account.id) throw new CrmError(409, "An account cannot be its own parent.", "CRM_ACCOUNT_PARENT_SELF");
    const values = [context.organizationId, parentId];
    parent = (await client.query(
      `SELECT account.id, account.display_name, account.status FROM tenant.business_parties account
        WHERE account.organization_id = $1 AND account.id = $2 AND ${CRM_ACCOUNT_PARTY_SQL("account")}${accountScopeSql(context, values, "account")}`,
      values,
    )).rows[0];
    if (!parent) throw new CrmError(404, "Parent account not found.", "CRM_ACCOUNT_NOT_FOUND");
    if (parent.status === "archived") throw new CrmError(409, "Choose an account that is not archived.", "CRM_ACCOUNT_ARCHIVED");
    // The new parent must not already sit below this account.
    const loop = await client.query(
      `WITH RECURSIVE chain AS (
         SELECT id, parent_party_id, 1 AS depth FROM tenant.business_parties WHERE organization_id = $1 AND id = $2
         UNION ALL
         SELECT party.id, party.parent_party_id, chain.depth + 1 FROM tenant.business_parties party
           JOIN chain ON party.organization_id = $1 AND party.id = chain.parent_party_id WHERE chain.depth < 50)
       SELECT 1 FROM chain WHERE id = $3 LIMIT 1`,
      [context.organizationId, parentId, account.id],
    );
    if (loop.rows[0]) throw new CrmError(409, "That account is already below this one, so it cannot be its parent.", "CRM_ACCOUNT_PARENT_CYCLE");
  }
  await client.query(`UPDATE tenant.business_parties SET parent_party_id = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, account.id, parentId, context.userId ?? null]);
  await recordAccountHistory(client, context, account.id, "parent_changed",
    parent ? `Parent account: ${parent.display_name}` : "Parent account removed", { from: account.parent_party_id, to: parentId });
  return { changed: true };
}

// The account's parent chain (nearest first) and its direct children.
export async function getAccountHierarchy(client, context, partyId) {
  const account = await getAccount(client, context, partyId);
  const parents = await client.query(
    `WITH RECURSIVE chain AS (
       SELECT id, display_name, code, parent_party_id, 0 AS depth FROM tenant.business_parties WHERE organization_id = $1 AND id = $2
       UNION ALL
       SELECT party.id, party.display_name, party.code, party.parent_party_id, chain.depth + 1 FROM tenant.business_parties party
         JOIN chain ON party.organization_id = $1 AND party.id = chain.parent_party_id WHERE chain.depth < 20)
     SELECT id, display_name, code FROM chain WHERE depth > 0 ORDER BY depth`,
    [context.organizationId, account.id],
  );
  const values = [context.organizationId, account.id];
  const children = await client.query(
    `SELECT account.id, account.code, account.display_name, account.account_type, account.status, owner.full_name AS owner_name
       FROM tenant.business_parties account LEFT JOIN public.users owner ON owner.id = account.owner_user_id
      WHERE account.organization_id = $1 AND account.parent_party_id = $2${accountScopeSql(context, values, "account")}
      ORDER BY lower(account.display_name)`,
    values,
  );
  return {
    parents: parents.rows.map((row) => ({ id: row.id, code: row.code, name: row.display_name })),
    children: children.rows.map((row) => ({ id: row.id, code: row.code, name: row.display_name, accountType: row.account_type, status: row.status, ownerName: row.owner_name })),
  };
}
