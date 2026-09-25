import { LeadSourceError, validateLeadSourceAssignment } from "../prospect-and-relationship-master-data/lead-source-validation.js";
import { CrmError } from "./errors.js";


export function camelize(value) {
  return value.replace(/_([a-z])/g, (_match, character) =>
    character.toUpperCase(),
  );
}


export function camelizeRow(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [camelize(key), value]),
  );
}


export function limitValue(value, fallback = 100, maximum = 500) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(maximum, Math.trunc(parsed)))
    : fallback;
}


// F024 — "my team": active members of every active sales team the caller
// manages. One definition shared by the dashboard, record-list drill-down
// (ownerId=team) and the task list, so every "team" figure reconciles.
export function managedTeamMembersSql(organizationParam, userParam) {
  return `SELECT member.user_id FROM tenant.crm_sales_team_members member
          JOIN tenant.crm_sales_teams team ON team.id = member.team_id AND team.organization_id = member.organization_id
         WHERE team.organization_id = ${organizationParam} AND team.manager_user_id = ${userParam} AND team.status = 'active'
           AND member.status = 'active' AND member.effective_from <= now() AND (member.effective_to IS NULL OR member.effective_to >= now())`;
}

export function addParameter(parameters, value) {
  parameters.push(value);
  return `$${parameters.length}`;
}



export async function assertLeadSourceAssignment(client, context, sourceId, options) {
  try {
    return await validateLeadSourceAssignment(
      client,
      context,
      sourceId,
      options,
    );
  } catch (error) {
    if (error instanceof LeadSourceError)
      throw new CrmError(
        error.status,
        error.message,
        error.code,
        error.details,
      );
    throw error;
  }
}
