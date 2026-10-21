import { listLeadAssignmentOptions } from "../leads/assignment.js";
import { listLeadStages } from "../leads/stages.js";
import { ensureDefaultLeadSources } from "../leads/sources.js";
import { canViewAllCrmRecords } from "./record-policy.js";
import { canViewAllCrmResource, managedTeamMemberIds } from "./crm-access-scope.js";
import { camelizeRow } from "./record-utils.js";



// The small reference lists CRM screens share (people, teams, pipelines, stages, sources…). Companies, contacts, products, leads and
// deals are NOT here: at FMCG scale (10,000+ outlets, thousands of SKUs) they are picked by search-as-you-type (AccountPicker, the
// deal's product search, …), 20 at a time, never sent whole with every form.
export async function getCrmOptions(client, context) {
  const parameters = [context.organizationId];
  const queryOptions = (sql, values) => client.query(sql, values);
  const currencies = await queryOptions(
    `SELECT code AS id, code AS name FROM tenant.currencies WHERE organization_id = $1 AND status = 'active' ORDER BY is_base DESC, code`,
    parameters,
  );
  const pipelines = await queryOptions(
    `SELECT pipeline.id, pipeline.name FROM tenant.crm_pipelines pipeline WHERE pipeline.organization_id = $1 AND pipeline.status = 'active' ORDER BY pipeline.is_default DESC, pipeline.name`,
    parameters,
  );
  const stages = await queryOptions(
    `SELECT stage.id, stage.pipeline_id, stage.name, stage.sequence, stage.probability, stage.is_won, stage.is_lost, stage.stale_after_days FROM tenant.crm_pipeline_stages stage JOIN tenant.crm_pipelines pipeline ON pipeline.id = stage.pipeline_id AND pipeline.organization_id = stage.organization_id WHERE stage.organization_id = $1 AND stage.status = 'active' ORDER BY stage.pipeline_id, stage.sequence`,
    parameters,
  );
  await ensureDefaultLeadSources(client, context);
  const sources = await queryOptions(
    `SELECT id, name, status FROM tenant.crm_lead_sources WHERE organization_id = $1 AND status = 'active' ORDER BY is_default DESC, sort_order, name`,
    parameters,
  );
  const allSources = await queryOptions(
    `SELECT id, name, status FROM tenant.crm_lead_sources WHERE organization_id = $1 ORDER BY status = 'active' DESC, is_default DESC, sort_order, name`,
    parameters,
  );
  const users = (await listLeadAssignmentOptions(client, context)).users;
  // Whom the caller may make a record owner (assertCrmOwnerAssignable):
  // null = anyone eligible (view-all); otherwise self + managed team members.
  // Lead ownership follows the Lead rule (crm.leads.view_all may route any
  // Lead); every other owner field follows the umbrella rule.
  const teamIds = canViewAllCrmRecords(context) ? [] : [...(await managedTeamMemberIds(client, context))];
  const assignableOwnerIds = canViewAllCrmResource(context, "opportunities") ? null : [String(context.userId), ...teamIds];
  const assignableLeadOwnerIds = canViewAllCrmResource(context, "leads") ? null : [String(context.userId), ...teamIds];
  // Every active member of the organization — for naming and picking people
  // in team setup, which is not
  // limited to whoever is currently eligible for lead assignment.
  const members = await client.query(
    `SELECT u.id, u.full_name AS name FROM public.users u JOIN public.organization_memberships membership ON membership.user_id = u.id WHERE membership.organization_id = $1 AND membership.status = 'active' ORDER BY u.full_name`,
    [context.organizationId],
  );
  const priceLists = await queryOptions(
    `SELECT id, name, currency_code FROM tenant.price_lists WHERE organization_id = $1 AND status = 'active' ORDER BY name`,
    parameters,
  );
  const lostReasons = await queryOptions(
    `SELECT id, name, outcome_type FROM tenant.crm_lost_reasons WHERE organization_id = $1 AND status = 'active' ORDER BY outcome_type, category, name`,
    parameters,
  );
  const salesTeams = await queryOptions(
    `SELECT team.id, team.name FROM tenant.crm_sales_teams team WHERE team.organization_id = $1 AND team.status = 'active' ORDER BY team.name`,
    parameters,
  );

  const map = (result) => result.rows.map(camelizeRow);
  return {
    currencies: map(currencies),
    pipelines: map(pipelines),
    stages: map(stages),
    leadStages: await listLeadStages(client, context),
    sources: map(sources),
    allSources: map(allSources),
    users,
    usersTruncated: false,
    assignableOwnerIds,
    assignableLeadOwnerIds,
    members: members.rows.map(camelizeRow),
    priceLists: map(priceLists),
    lostReasons: map(lostReasons),
    salesTeams: map(salesTeams),
  };
}
