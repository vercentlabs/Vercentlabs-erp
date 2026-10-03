// F002 Account hierarchy: ancestor/descendant walk rebased to what the caller
// may see, hierarchy history with restricted parents, and governed parent
// changes with an application-level cycle guard (the database has its own).

import { CrmAccountIntelligenceError, assertId } from "../account-intelligence-error.js";
import { projectAccountForContext } from "../account-security.js";
import { intelligenceScope, loadScopedAccount, redactHiddenParent } from "../record-access.js";

const text = (value) => String(value ?? "").trim();

// The hierarchy walk sees the real structure; what leaves the server is the
// VISIBLE structure only. Hidden Accounts are dropped, `depth` is rebased to
// count visible Accounts between the root and the node (so a gap never
// reveals how many hidden levels exist), and a parent link survives only
// when the parent itself is visible.
function rebaseVisibleHierarchy(rootId, rows, direction) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const visible = (id) => id === rootId || byId.get(id)?.caller_can_access === true;
  const visibleDepth = (row) => {
    // Count visible nodes on the path from this node toward the root.
    let depth = 0;
    if (direction === "descendants") {
      for (let node = row; node && node.id !== rootId; node = byId.get(node.parent_party_id)) if (visible(node.id)) depth += 1;
    } else {
      // Ancestors come ordered farthest-first; nearer ancestors have lower real depth.
      depth = rows.filter((other) => Number(other.depth) <= Number(row.depth) && visible(other.id)).length;
    }
    return depth;
  };
  return rows
    .filter((row) => visible(row.id))
    .map(({ caller_can_access: _access, ...row }) => ({
      ...row,
      depth: visibleDepth({ ...row, caller_can_access: true }),
      parent_party_id: row.parent_party_id && visible(row.parent_party_id) ? row.parent_party_id : null,
      // Existence only (no id, name or depth): the UI can say "parent
      // restricted" instead of implying the node has no parent.
      parent_restricted: Boolean(row.parent_party_id) && !visible(row.parent_party_id),
    }));
}

export async function getAccountHierarchy(client, context, partyId) {
  const root = await loadScopedAccount(client, context, partyId);
  // The walk follows the real structure, but only Accounts the caller may
  // open are returned (and counted): a parent/child id is never a way to
  // discover an Account outside the caller's ownership scope.
  const ancestorParameters = [context.organizationId, partyId];
  const descendantParameters = [context.organizationId, partyId];
  const historyParameters = [context.organizationId, partyId];
  const ancestors = await client.query(
    `WITH RECURSIVE tree AS (
       SELECT party.id,party.parent_party_id,party.display_name,party.legal_name,party.party_type,party.status,0 AS depth
       FROM tenant.business_parties party
       WHERE party.organization_id=$1 AND party.id=$2
       UNION ALL
       SELECT parent.id,parent.parent_party_id,parent.display_name,parent.legal_name,parent.party_type,parent.status,tree.depth+1
       FROM tenant.business_parties parent
       JOIN tree ON tree.parent_party_id=parent.id
       WHERE parent.organization_id=$1 AND tree.depth<50
     )
     SELECT tree.*, (true${intelligenceScope(context, ancestorParameters, "visible", "account")}) AS caller_can_access FROM tree
       JOIN tenant.business_parties visible ON visible.organization_id=$1 AND visible.id=tree.id
      WHERE tree.depth>0
      ORDER BY tree.depth DESC`,
    ancestorParameters,
  );
  const descendants = await client.query(
    `WITH RECURSIVE tree AS (
       SELECT party.id,party.parent_party_id,party.display_name,party.legal_name,party.party_type,party.status,0 AS depth
       FROM tenant.business_parties party
       WHERE party.organization_id=$1 AND party.id=$2
       UNION ALL
       SELECT child.id,child.parent_party_id,child.display_name,child.legal_name,child.party_type,child.status,tree.depth+1
       FROM tenant.business_parties child
       JOIN tree ON child.parent_party_id=tree.id
       WHERE child.organization_id=$1 AND tree.depth<50
     )
     SELECT tree.*, (true${intelligenceScope(context, descendantParameters, "visible", "account")}) AS caller_can_access FROM tree
       JOIN tenant.business_parties visible ON visible.organization_id=$1 AND visible.id=tree.id
      WHERE tree.depth>0
      ORDER BY tree.depth,tree.display_name`,
    descendantParameters,
  );
  const history = await client.query(
    `SELECT event.*,
            (previous_parent.id IS NULL OR (true${intelligenceScope(context, historyParameters, "previous_parent", "account")})) AS previous_parent_visible,
            (new_parent.id IS NULL OR (true${intelligenceScope(context, historyParameters, "new_parent", "account")})) AS new_parent_visible,
            previous_parent.display_name AS previous_parent_name,new_parent.display_name AS new_parent_name,
            actor.full_name AS changed_by_name
     FROM tenant.crm_account_hierarchy_events event
     LEFT JOIN tenant.business_parties previous_parent
       ON previous_parent.organization_id=event.organization_id AND previous_parent.id=event.previous_parent_party_id
     LEFT JOIN tenant.business_parties new_parent
       ON new_parent.organization_id=event.organization_id AND new_parent.id=event.new_parent_party_id
     LEFT JOIN public.users actor ON actor.id=event.changed_by
     WHERE event.organization_id=$1 AND event.party_id=$2
     ORDER BY event.changed_at DESC LIMIT 100`,
    historyParameters,
  );
  const visibleAncestors = rebaseVisibleHierarchy(root.id, ancestors.rows, "ancestors");
  const visibleDescendants = rebaseVisibleHierarchy(root.id, descendants.rows, "descendants");
  return {
    // Record access and field access are separate layers: GSTIN/PAN/MSME
    // stay behind crm.accounts.view_sensitive here too.
    account: projectAccountForContext(context, redactHiddenParent(root)),
    ancestors: visibleAncestors,
    descendants: visibleDescendants,
    // A parent the caller cannot open is shown as restricted: no id, no name.
    history: history.rows.map(({ previous_parent_visible: previousVisible, new_parent_visible: newVisible, ...event }) => ({
      ...event,
      previous_parent_party_id: previousVisible ? event.previous_parent_party_id : null,
      previous_parent_name: previousVisible ? event.previous_parent_name : event.previous_parent_party_id ? "Restricted account" : null,
      new_parent_party_id: newVisible ? event.new_parent_party_id : null,
      new_parent_name: newVisible ? event.new_parent_name : event.new_parent_party_id ? "Restricted account" : null,
    })),
    metrics: {
      ancestorCount: visibleAncestors.length,
      descendantCount: visibleDescendants.length,
      hierarchyDepth: Math.max(0, ...visibleDescendants.map((row) => Number(row.depth || 0))),
    },
  };
}

export async function setAccountParent(
  client,
  context,
  partyId,
  parentPartyId,
  reason = null,
) {
  const childId = assertId(partyId, "Account");
  const nextParentId = parentPartyId
    ? assertId(parentPartyId, "Parent account")
    : null;
  if (nextParentId === childId) {
    throw new CrmAccountIntelligenceError(
      409,
      "An account cannot be its own parent.",
      "CRM_ACCOUNT_HIERARCHY_SELF_PARENT",
    );
  }
  const child = await loadScopedAccount(client, context, childId, true);
  if (nextParentId) {
    const parent = await loadScopedAccount(client, context, nextParentId, true);
    if (parent.status !== "active") {
      throw new CrmAccountIntelligenceError(
        409,
        "The parent account must be active.",
        "CRM_ACCOUNT_HIERARCHY_PARENT_INACTIVE",
      );
    }
    const cycle = await client.query(
      `WITH RECURSIVE ancestors AS (
         SELECT party.id,party.parent_party_id
         FROM tenant.business_parties party
         WHERE party.organization_id=$1 AND party.id=$2
         UNION ALL
         SELECT parent.id,parent.parent_party_id
         FROM tenant.business_parties parent
         JOIN ancestors child ON child.parent_party_id=parent.id
         WHERE parent.organization_id=$1
       ) SELECT 1 FROM ancestors WHERE id=$3 LIMIT 1`,
      [context.organizationId, nextParentId, childId],
    );
    if (cycle.rows[0]) {
      throw new CrmAccountIntelligenceError(
        409,
        "The selected parent would create an account hierarchy cycle.",
        "CRM_ACCOUNT_HIERARCHY_CYCLE",
      );
    }
  }
  if ((child.parent_party_id || null) === nextParentId) return projectAccountForContext(context, redactHiddenParent(child));
  const updated = await client.query(
    `UPDATE tenant.business_parties
     SET parent_party_id=$1,updated_by=$2,updated_at=now()
     WHERE organization_id=$3 AND id=$4 RETURNING *`,
    [nextParentId, context.userId, context.organizationId, childId],
  );
  await client.query(
    `INSERT INTO tenant.crm_account_hierarchy_events(
       organization_id,party_id,previous_parent_party_id,new_parent_party_id,action,reason,changed_by
     ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      context.organizationId,
      childId,
      child.parent_party_id || null,
      nextParentId,
      nextParentId ? "parent_set" : "parent_cleared",
      text(reason) || null,
      context.userId,
    ],
  );
  return projectAccountForContext(context, updated.rows[0]);
}
