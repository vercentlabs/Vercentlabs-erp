// Hierarchy rule for the generic Sales team update: a team may not become
// its own parent or its own ancestor. Called by
// data-management/resource-mutation-service.js before the row is written.

import { CrmError } from "../data-management/errors.js";


export async function assertSalesTeamParentAllowed(client, context, resource, id, prepared) {
  if (
    resource === "sales-teams" &&
    Object.prototype.hasOwnProperty.call(prepared, "parentTeamId") &&
    prepared.parentTeamId
  ) {
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
