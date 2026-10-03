import { listEligibleLeadAssigneesForPicker } from "../lead-management/assignment/eligibility.js";
import { canViewAllCrmRecords } from "./record-policy.js";
import { canViewAllCrmResource, crmAccountAccessSql, crmOwnerScopeSql, managedTeamMemberIds } from "./crm-access-scope.js";
import { camelizeRow } from "./record-utils.js";



export async function getCrmOptions(client, context) {
  const parameters = [context.organizationId];
  // Owner/record scope for the two option lists backed by owner-scoped
  // resources (leads, opportunities): a restricted seller must not be able
  // to enumerate every other seller's Lead/Opportunity id+name through
  // options/combobox endpoints, since the real list/detail queries for both
  // resources also apply owner scope via recordScope() — dropdowns must
  // never reveal more than the record's own list/detail view would.
  //
  // A SEPARATE, longer parameter array — not appended to the shared
  // `parameters` above — because every other queryOptions() call below
  // reuses that same array as its bound values, and Postgres's extended
  // query protocol rejects a Bind message that supplies more values than
  // the specific statement's own placeholder count declares.
  const ownerScopedParameters = [
    ...parameters,
    context.userId,
    Boolean(canViewAllCrmRecords(context)),
  ];
  // Own + unassigned + owned by a member of a team the caller manages (the
  // shared rule, crm-access-scope.js), with $2 = caller and $3 = view-all.
  // Resource-aware (crm.leads.view_all widens only the Lead picker, partner
  // and customer grants apply) via the one central rule. $2 stays referenced
  // even when the caller may see every row of that resource, because every
  // owner-scoped statement binds it.
  const ownerVisible = (alias, resource, column = "owner_user_id") => {
    const scope = crmOwnerScopeSql(context, () => "$2", `${alias}.${column}`, `${alias}.organization_id`, { resource, alias });
    return `($3::boolean OR ${scope ? scope.replace(/^ AND /, "") : "($2::uuid IS NULL OR true)"})`;
  };

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
  const leadStages = await queryOptions(
    `SELECT stage.id,stage.code,stage.name,stage.description,stage.sort_order,stage.status,stage.is_initial,stage.is_system,
            coalesce(array_agg(source.code ORDER BY source.sort_order,source.id)
              FILTER (WHERE transition.from_stage_id IS NOT NULL),'{}'::text[]) AS allowed_from_codes
       FROM tenant.crm_lead_stages stage
       LEFT JOIN tenant.crm_lead_stage_transitions transition
         ON transition.organization_id=stage.organization_id AND transition.to_stage_id=stage.id
       LEFT JOIN tenant.crm_lead_stages source
         ON source.organization_id=transition.organization_id AND source.id=transition.from_stage_id
      WHERE stage.organization_id=$1
      GROUP BY stage.id
      ORDER BY stage.status='active' DESC,stage.sort_order,stage.id`,
    parameters,
  );
  const sources = await queryOptions(
    `SELECT id, name, status FROM tenant.crm_lead_sources WHERE organization_id = $1 AND status = 'active' ORDER BY is_default DESC, sort_order, name`,
    parameters,
  );
  const allSources = await queryOptions(
    `SELECT id, name, status FROM tenant.crm_lead_sources WHERE organization_id = $1 ORDER BY status = 'active' DESC, is_default DESC, sort_order, name`,
    parameters,
  );
  const campaigns = await queryOptions(
    `SELECT campaign.id, campaign.name FROM tenant.crm_campaigns campaign WHERE campaign.organization_id = $1 AND campaign.status IN ('planned','active','paused') ORDER BY campaign.name`,
    parameters,
  );
  const users = await listEligibleLeadAssigneesForPicker(client, context);
  // Whom the caller may make a record owner (assertCrmOwnerAssignable):
  // null = anyone eligible (view-all); otherwise self + managed team members.
  // Lead ownership follows the Lead rule (crm.leads.view_all may route any
  // Lead); every other owner field follows the umbrella rule.
  const teamIds = canViewAllCrmRecords(context) ? [] : [...(await managedTeamMemberIds(client, context))];
  const assignableOwnerIds = canViewAllCrmResource(context, "opportunities") ? null : [String(context.userId), ...teamIds];
  const assignableLeadOwnerIds = canViewAllCrmResource(context, "leads") ? null : [String(context.userId), ...teamIds];
  // Every active member of the organization — for naming and picking people
  // in sales-organization setup (teams, territories, quotas), which is not
  // limited to whoever is currently eligible for lead assignment.
  const members = await client.query(
    `SELECT u.id, u.full_name AS name FROM public.users u JOIN public.organization_memberships membership ON membership.user_id = u.id WHERE membership.organization_id = $1 AND membership.status = 'active' ORDER BY u.full_name`,
    [context.organizationId],
  );
  // Account/Contact pickers follow the Account ownership rule too
  // (crm-access-scope.js); $2 = caller, bound only when the rule applies.
  const accountAccess = crmAccountAccessSql(context, () => "$2", "party");
  const accountParameters = accountAccess ? [...parameters, context.userId] : parameters;
  const parties = await queryOptions(
    `SELECT party.id, party.display_name AS name FROM tenant.business_parties party WHERE party.organization_id = $1 AND party.status = 'active'${accountAccess} ORDER BY party.display_name`,
    accountParameters,
  );
  const contacts = await queryOptions(
    `SELECT contact.id, btrim(contact.first_name || ' ' || COALESCE(contact.last_name,'')) AS name, contact.party_id FROM tenant.contacts contact JOIN tenant.business_parties party ON party.id = contact.party_id AND party.organization_id = contact.organization_id WHERE contact.organization_id = $1 AND contact.status = 'active'${accountAccess} ORDER BY contact.first_name, contact.last_name`,
    accountParameters,
  );
  const items = await queryOptions(
    `SELECT id, name, sales_price FROM tenant.items WHERE organization_id = $1 AND status = 'active' ORDER BY name`,
    parameters,
  );
  const priceLists = await queryOptions(
    `SELECT id, name, currency_code FROM tenant.price_lists WHERE organization_id = $1 AND status = 'active' ORDER BY name`,
    parameters,
  );
  const tags = await queryOptions(
    `SELECT id, name, color FROM tenant.crm_tags WHERE organization_id = $1 AND status = 'active' ORDER BY name`,
    parameters,
  );
  const lostReasons = await queryOptions(
    `SELECT id, name, outcome_type FROM tenant.crm_lost_reasons WHERE organization_id = $1 AND status = 'active' ORDER BY outcome_type, category, name`,
    parameters,
  );
  const leads = await queryOptions(
    `SELECT lead.id, btrim(lead.first_name || ' ' || COALESCE(lead.last_name,'')) AS name FROM tenant.crm_leads lead WHERE lead.organization_id = $1 AND lead.record_status='active' AND ${ownerVisible("lead", "leads")} ORDER BY lead.updated_at DESC LIMIT 500`,
    ownerScopedParameters,
  );
  const opportunities = await queryOptions(
    `SELECT opportunity.id, opportunity.name FROM tenant.crm_opportunities opportunity WHERE opportunity.organization_id = $1 AND opportunity.status <> 'archived' AND ${ownerVisible("opportunity", "opportunities")} ORDER BY opportunity.updated_at DESC LIMIT 500`,
    ownerScopedParameters,
  );
  const sequences = await queryOptions(
    `SELECT id, name FROM tenant.crm_sequences WHERE organization_id = $1 AND status <> 'archived' ORDER BY name`,
    parameters,
  );
  const salesTeams = await queryOptions(
    `SELECT team.id, team.name FROM tenant.crm_sales_teams team WHERE team.organization_id = $1 AND team.status = 'active' ORDER BY team.name`,
    parameters,
  );
  const territories = await queryOptions(
    `SELECT territory.id, territory.name FROM tenant.crm_territories territory WHERE territory.organization_id = $1 AND territory.status = 'active' ORDER BY territory.name`,
    parameters,
  );
  const forecastPeriods = await queryOptions(
    `SELECT period.id, period.name, period.period_start, period.period_end FROM tenant.crm_forecast_periods period WHERE period.organization_id = $1 AND period.status IN ('planned','open','frozen') ORDER BY period.period_start DESC`,
    parameters,
  );
  const accountPlans = await queryOptions(
    `SELECT plan.id, party.display_name AS name FROM tenant.crm_account_plans plan JOIN tenant.business_parties party ON party.id = plan.party_id AND party.organization_id = plan.organization_id WHERE plan.organization_id = $1 AND plan.status = 'active' ORDER BY party.display_name`,
    parameters,
  );
  const playbooks = await queryOptions(
    `SELECT playbook.id, playbook.name FROM tenant.crm_playbooks playbook WHERE playbook.organization_id = $1 AND playbook.status = 'active' ORDER BY playbook.name`,
    parameters,
  );
  const playbookQuestions = await queryOptions(
    `SELECT question.id, question.prompt AS name, question.playbook_id FROM tenant.crm_playbook_questions question WHERE question.organization_id = $1 AND question.status = 'active' ORDER BY question.sequence, question.prompt`,
    parameters,
  );
  const conversations = await queryOptions(
    `SELECT conversation.id, COALESCE(conversation.title, initcap(replace(conversation.channel, '_', ' '))) AS name FROM tenant.crm_conversations conversation WHERE conversation.organization_id = $1 AND conversation.status <> 'archived' ORDER BY conversation.started_at DESC NULLS LAST, conversation.created_at DESC LIMIT 500`,
    parameters,
  );
  const buyingCommittees = await queryOptions(
    `SELECT committee.id, committee.name FROM tenant.crm_buying_committees committee WHERE committee.organization_id = $1 AND committee.status = 'active' ORDER BY committee.name`,
    parameters,
  );
  const partnerAccounts = await queryOptions(
    `SELECT partner.id, partner.name FROM tenant.crm_partner_accounts partner WHERE partner.organization_id = $1 AND partner.status = 'active' ORDER BY partner.name`,
    parameters,
  );
  const customObjects = await queryOptions(
    `SELECT definition.id, definition.plural_label AS name, definition.object_key FROM tenant.crm_custom_object_definitions definition WHERE definition.organization_id = $1 AND definition.status = 'active' ORDER BY definition.plural_label`,
    parameters,
  );
  const aiPredictions = await queryOptions(
    `SELECT prediction.id, concat(prediction.entity_type, ': ', prediction.prediction_type) AS name FROM tenant.crm_ai_predictions prediction WHERE prediction.organization_id = $1 AND prediction.status = 'active' ORDER BY prediction.created_at DESC LIMIT 500`,
    parameters,
  );
  const recommendations = await queryOptions(
    `SELECT recommendation.id, recommendation.title AS name FROM tenant.crm_recommendations recommendation WHERE recommendation.organization_id = $1 AND recommendation.status IN ('open','accepted') ORDER BY recommendation.priority DESC, recommendation.created_at DESC LIMIT 500`,
    parameters,
  );

  const map = (result) => result.rows.map(camelizeRow);
  return {
    currencies: map(currencies),
    pipelines: map(pipelines),
    stages: map(stages),
    leadStages: map(leadStages),
    sources: map(sources),
    allSources: map(allSources),
    campaigns: map(campaigns),
    users: users.items.map(camelizeRow),
    usersTruncated: users.truncated,
    assignableOwnerIds,
    assignableLeadOwnerIds,
    members: members.rows.map(camelizeRow),
    parties: map(parties),
    contacts: map(contacts),
    items: map(items),
    priceLists: map(priceLists),
    tags: map(tags),
    lostReasons: map(lostReasons),
    leads: map(leads),
    opportunities: map(opportunities),
    sequences: map(sequences),
    salesTeams: map(salesTeams),
    territories: map(territories),
    forecastPeriods: map(forecastPeriods),
    accountPlans: map(accountPlans),
    playbooks: map(playbooks),
    playbookQuestions: map(playbookQuestions),
    conversations: map(conversations),
    buyingCommittees: map(buyingCommittees),
    partnerAccounts: map(partnerAccounts),
    customObjects: map(customObjects),
    aiPredictions: map(aiPredictions),
    recommendations: map(recommendations),
  };
}
