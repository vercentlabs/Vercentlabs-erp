import { listEligibleLeadAssignees } from "../lead-lifecycle-qualification-and-prioritization/lead-governance.js";
import { canViewAllCrmRecords } from "./record-policy.js";
import { camelizeRow } from "./record-utils.js";



export async function getCrmOptions(client, context) {
  const parameters = [
    context.organizationId,
    context.activeCompanyId,
    context.activeBranchId,
    Boolean(context.allowAllCompanies),
  ];
  // Owner/record scope for the two option lists backed by owner-scoped
  // resources (leads, opportunities). Found this prompt: this function's
  // company/branch-only scoping let a restricted seller enumerate every
  // other seller's Lead/Opportunity id+name through options/combobox
  // endpoints, even though the real list/detail queries for both
  // resources also apply owner scope via recordScope() — dropdowns must
  // never reveal more than the record's own list/detail view would.
  //
  // A SEPARATE, longer parameter array — not appended to the shared
  // `parameters` above — because every other queryOptions() call below
  // reuses that same array as its bound values, and Postgres's extended
  // query protocol rejects a Bind message that supplies more values than
  // the specific statement's own placeholder count declares. Appending
  // $5/$6 here for every query (even ones whose text never references
  // them) previously broke every option list except leads/opportunities
  // with "bind message supplies N parameters, but prepared statement
  // requires 4" — found only against a real Postgres connection (E2E),
  // never by mocked unit tests.
  const ownerScopedParameters = [
    ...parameters,
    context.userId,
    Boolean(canViewAllCrmRecords(context)),
  ];
  const companyVisible = (alias, includeUnassigned = true) =>
    `($4::boolean OR ($2::uuid IS NOT NULL AND ${includeUnassigned ? `(${alias}.company_id IS NULL OR ${alias}.company_id = $2)` : `${alias}.company_id = $2`}))`;
  const branchVisible = (alias) =>
    `($4::boolean OR ($3::uuid IS NOT NULL AND (${alias}.branch_id IS NULL OR ${alias}.branch_id = $3)))`;
  const ownerVisible = (alias, column = "owner_user_id") =>
    `($6::boolean OR ${alias}.${column} IS NULL OR ${alias}.${column} = $5)`;

  const queryOptions = (sql, values) =>
    client.query(
      `WITH crm_scope_parameters AS (
        SELECT $1::uuid AS organization_id,
          $2::uuid AS active_company_id,
          $3::uuid AS active_branch_id,
          $4::boolean AS allow_all_companies
      )
      ${sql}`,
      values,
    );
  const companies = await queryOptions(
    `SELECT company.id, company.name FROM public.companies company WHERE company.organization_id = $1 AND company.status = 'active' AND ($4::boolean OR company.id = $2) ORDER BY company.is_primary DESC, company.name`,
    parameters,
  );
  const branches = await queryOptions(
    `SELECT branch.id, branch.name, branch.company_id FROM public.branches branch WHERE branch.organization_id = $1 AND branch.status = 'active' AND ${companyVisible("branch", false)} AND ($4::boolean OR ($3::uuid IS NOT NULL AND branch.id = $3)) ORDER BY branch.is_primary DESC, branch.name`,
    parameters,
  );
  const currencies = await queryOptions(
    `SELECT code AS id, code AS name FROM tenant.currencies WHERE organization_id = $1 AND status = 'active' ORDER BY is_base DESC, code`,
    parameters,
  );
  const pipelines = await queryOptions(
    `SELECT pipeline.id, pipeline.name, pipeline.company_id FROM tenant.crm_pipelines pipeline WHERE pipeline.organization_id = $1 AND pipeline.status = 'active' AND ${companyVisible("pipeline")} ORDER BY pipeline.is_default DESC, pipeline.name`,
    parameters,
  );
  const stages = await queryOptions(
    `SELECT stage.id, stage.pipeline_id, stage.name, stage.sequence, stage.probability, stage.is_won, stage.is_lost, stage.stale_after_days FROM tenant.crm_pipeline_stages stage JOIN tenant.crm_pipelines pipeline ON pipeline.id = stage.pipeline_id AND pipeline.organization_id = stage.organization_id WHERE stage.organization_id = $1 AND stage.status = 'active' AND ${companyVisible("pipeline")} ORDER BY stage.pipeline_id, stage.sequence`,
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
    `SELECT campaign.id, campaign.name FROM tenant.crm_campaigns campaign WHERE campaign.organization_id = $1 AND campaign.status IN ('planned','active','paused') AND ${companyVisible("campaign")} ORDER BY campaign.name`,
    parameters,
  );
  const users = await listEligibleLeadAssignees(client, context, { limit: 50 });
  // Every active member of the organization — for naming and picking people
  // in sales-organization setup (teams, territories, quotas), which is not
  // limited to whoever is currently eligible for lead assignment.
  const members = await client.query(
    `SELECT u.id, u.full_name AS name FROM public.users u JOIN public.organization_memberships membership ON membership.user_id = u.id WHERE membership.organization_id = $1 AND membership.status = 'active' ORDER BY u.full_name`,
    [context.organizationId],
  );
  const parties = await queryOptions(
    `SELECT party.id, party.display_name AS name FROM tenant.business_parties party WHERE party.organization_id = $1 AND party.status = 'active' AND ${companyVisible("party")} ORDER BY party.display_name`,
    parameters,
  );
  const contacts = await queryOptions(
    `SELECT contact.id, btrim(contact.first_name || ' ' || COALESCE(contact.last_name,'')) AS name, contact.party_id FROM tenant.contacts contact JOIN tenant.business_parties party ON party.id = contact.party_id AND party.organization_id = contact.organization_id WHERE contact.organization_id = $1 AND contact.status = 'active' AND ${companyVisible("party")} ORDER BY contact.first_name, contact.last_name`,
    parameters,
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
    `SELECT lead.id, btrim(lead.first_name || ' ' || COALESCE(lead.last_name,'')) AS name FROM tenant.crm_leads lead WHERE lead.organization_id = $1 AND lead.record_status='active' AND ${companyVisible("lead")} AND ${branchVisible("lead")} AND ${ownerVisible("lead")} ORDER BY lead.updated_at DESC LIMIT 500`,
    ownerScopedParameters,
  );
  const opportunities = await queryOptions(
    `SELECT opportunity.id, opportunity.name FROM tenant.crm_opportunities opportunity WHERE opportunity.organization_id = $1 AND opportunity.status <> 'archived' AND ${companyVisible("opportunity")} AND ${branchVisible("opportunity")} AND ${ownerVisible("opportunity")} ORDER BY opportunity.updated_at DESC LIMIT 500`,
    ownerScopedParameters,
  );
  const sequences = await queryOptions(
    `SELECT id, name FROM tenant.crm_sequences WHERE organization_id = $1 AND status <> 'archived' ORDER BY name`,
    parameters,
  );
  const salesTeams = await queryOptions(
    `SELECT team.id, team.name, team.company_id FROM tenant.crm_sales_teams team WHERE team.organization_id = $1 AND team.status = 'active' AND ${companyVisible("team")} ORDER BY team.name`,
    parameters,
  );
  const territories = await queryOptions(
    `SELECT territory.id, territory.name, territory.company_id FROM tenant.crm_territories territory WHERE territory.organization_id = $1 AND territory.status = 'active' AND ${companyVisible("territory")} ORDER BY territory.name`,
    parameters,
  );
  const forecastPeriods = await queryOptions(
    `SELECT period.id, period.name, period.period_start, period.period_end, period.company_id FROM tenant.crm_forecast_periods period WHERE period.organization_id = $1 AND period.status IN ('planned','open','frozen') AND ${companyVisible("period")} ORDER BY period.period_start DESC`,
    parameters,
  );
  const accountPlans = await queryOptions(
    `SELECT plan.id, party.display_name AS name, plan.company_id FROM tenant.crm_account_plans plan JOIN tenant.business_parties party ON party.id = plan.party_id AND party.organization_id = plan.organization_id WHERE plan.organization_id = $1 AND plan.status = 'active' AND ${companyVisible("plan")} ORDER BY party.display_name`,
    parameters,
  );
  const playbooks = await queryOptions(
    `SELECT playbook.id, playbook.name, playbook.company_id FROM tenant.crm_playbooks playbook WHERE playbook.organization_id = $1 AND playbook.status = 'active' AND ${companyVisible("playbook")} ORDER BY playbook.name`,
    parameters,
  );
  const playbookQuestions = await queryOptions(
    `SELECT question.id, question.prompt AS name, question.playbook_id, question.company_id FROM tenant.crm_playbook_questions question WHERE question.organization_id = $1 AND question.status = 'active' AND ${companyVisible("question")} ORDER BY question.sequence, question.prompt`,
    parameters,
  );
  const conversations = await queryOptions(
    `SELECT conversation.id, COALESCE(conversation.title, initcap(replace(conversation.channel, '_', ' '))) AS name, conversation.company_id FROM tenant.crm_conversations conversation WHERE conversation.organization_id = $1 AND conversation.status <> 'archived' AND ${companyVisible("conversation")} ORDER BY conversation.started_at DESC NULLS LAST, conversation.created_at DESC LIMIT 500`,
    parameters,
  );
  const buyingCommittees = await queryOptions(
    `SELECT committee.id, committee.name, committee.company_id FROM tenant.crm_buying_committees committee WHERE committee.organization_id = $1 AND committee.status = 'active' AND ${companyVisible("committee")} ORDER BY committee.name`,
    parameters,
  );
  const partnerAccounts = await queryOptions(
    `SELECT partner.id, partner.name, partner.company_id FROM tenant.crm_partner_accounts partner WHERE partner.organization_id = $1 AND partner.status = 'active' AND ${companyVisible("partner")} ORDER BY partner.name`,
    parameters,
  );
  const reportDefinitions = await queryOptions(
    `SELECT definition.id, definition.name, definition.company_id FROM tenant.crm_report_definitions definition WHERE definition.organization_id = $1 AND definition.status = 'active' AND ${companyVisible("definition")} ORDER BY definition.name`,
    parameters,
  );
  const dashboards = await queryOptions(
    `SELECT dashboard.id, dashboard.name, dashboard.company_id FROM tenant.crm_dashboards dashboard WHERE dashboard.organization_id = $1 AND dashboard.status = 'active' AND ${companyVisible("dashboard")} ORDER BY dashboard.name`,
    parameters,
  );
  const customObjects = await queryOptions(
    `SELECT definition.id, definition.plural_label AS name, definition.object_key FROM tenant.crm_custom_object_definitions definition WHERE definition.organization_id = $1 AND definition.status = 'active' ORDER BY definition.plural_label`,
    parameters,
  );
  const aiPredictions = await queryOptions(
    `SELECT prediction.id, concat(prediction.entity_type, ': ', prediction.prediction_type) AS name, prediction.company_id FROM tenant.crm_ai_predictions prediction WHERE prediction.organization_id = $1 AND prediction.status = 'active' AND ${companyVisible("prediction")} ORDER BY prediction.created_at DESC LIMIT 500`,
    parameters,
  );
  const recommendations = await queryOptions(
    `SELECT recommendation.id, recommendation.title AS name, recommendation.company_id FROM tenant.crm_recommendations recommendation WHERE recommendation.organization_id = $1 AND recommendation.status IN ('open','accepted') AND ${companyVisible("recommendation")} ORDER BY recommendation.priority DESC, recommendation.created_at DESC LIMIT 500`,
    parameters,
  );

  const map = (result) => result.rows.map(camelizeRow);
  return {
    companies: map(companies),
    branches: map(branches),
    currencies: map(currencies),
    pipelines: map(pipelines),
    stages: map(stages),
    leadStages: map(leadStages),
    sources: map(sources),
    allSources: map(allSources),
    campaigns: map(campaigns),
    users: users.items.map(camelizeRow),
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
    reportDefinitions: map(reportDefinitions),
    dashboards: map(dashboards),
    customObjects: map(customObjects),
    aiPredictions: map(aiPredictions),
    recommendations: map(recommendations),
  };
}
