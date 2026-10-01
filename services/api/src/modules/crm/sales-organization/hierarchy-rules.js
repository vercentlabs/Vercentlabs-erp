// F020 hierarchy rules for the generic Territory and Sales team updates: a
// record may not become its own parent or its own ancestor. Called by
// data-management/resource-mutation-service.js before the row is written.

import { CrmError } from "../data-management/errors.js";

export async function assertTerritoryParentAllowed(client, context, resource, id, prepared) {
  if (
    resource === "territories" &&
    Object.prototype.hasOwnProperty.call(prepared, "parentTerritoryId") &&
    prepared.parentTerritoryId
  ) {
    // F020 CAP-001: mirrors setAccountParent's cycle guard (account-intelligence.js)
    // — the same self-parent/ancestor-cycle problem, solved the same way, for
    // territory hierarchy. Previously unguarded: any parent could be assigned,
    // including one that would make the territory its own ancestor.
    if (prepared.parentTerritoryId === id)
      throw new CrmError(
        409,
        "A territory cannot be its own parent.",
        "CRM_TERRITORY_HIERARCHY_SELF_PARENT",
      );
    const cycle = await client.query(
      `WITH RECURSIVE ancestors AS (
         SELECT territory.id, territory.parent_territory_id
           FROM tenant.crm_territories territory
          WHERE territory.organization_id=$1 AND territory.id=$2
         UNION ALL
         SELECT parent.id, parent.parent_territory_id
           FROM tenant.crm_territories parent
           JOIN ancestors child ON child.parent_territory_id=parent.id
          WHERE parent.organization_id=$1
       ) SELECT 1 FROM ancestors WHERE id=$3 LIMIT 1`,
      [context.organizationId, prepared.parentTerritoryId, id],
    );
    if (cycle.rows[0])
      throw new CrmError(
        409,
        "The selected parent would create a territory hierarchy cycle.",
        "CRM_TERRITORY_HIERARCHY_CYCLE",
      );
  }
}

export async function assertSalesTeamParentAllowed(client, context, resource, id, prepared) {
  if (
    resource === "sales-teams" &&
    Object.prototype.hasOwnProperty.call(prepared, "parentTeamId") &&
    prepared.parentTeamId
  ) {
    // F020 Tranche D (Stage A): same self-parent/ancestor-cycle guard as
    // territories immediately above, for sales-team hierarchy. Previously
    // unguarded — any parent team could be assigned, including one that
    // would make the team its own ancestor.
    if (prepared.parentTeamId === id)
      throw new CrmError(
        409,
        "A sales team cannot be its own parent.",
        "CRM_SALES_TEAM_HIERARCHY_SELF_PARENT",
      );
    const teamCycle = await client.query(
      `WITH RECURSIVE ancestors AS (
         SELECT team.id, team.parent_team_id
           FROM tenant.crm_sales_teams team
          WHERE team.organization_id=$1 AND team.id=$2
         UNION ALL
         SELECT parent.id, parent.parent_team_id
           FROM tenant.crm_sales_teams parent
           JOIN ancestors child ON child.parent_team_id=parent.id
          WHERE parent.organization_id=$1
       ) SELECT 1 FROM ancestors WHERE id=$3 LIMIT 1`,
      [context.organizationId, prepared.parentTeamId, id],
    );
    if (teamCycle.rows[0])
      throw new CrmError(
        409,
        "The selected parent would create a sales-team hierarchy cycle.",
        "CRM_SALES_TEAM_HIERARCHY_CYCLE",
      );
  }
}
