// The opportunity pipeline: the organization's open deals laid out by sales
// stage, with totals for each stage and for the whole pipeline.
//
// The pipeline is a view over opportunities, not a record of its own. It
// reads each deal's actual stage and uses the opportunity list's own WHERE
// clause (buildOpportunityListWhere), so the board, the list, the export and
// the "CRM Opportunities by Stage" report always agree, and a caller sees only
// the deals they may see (own, team or all).
import { opportunityCapabilities, opportunityScopeSql, requireOpportunityPermission } from "../opportunities/access.js";
import { OPPORTUNITY_PERMISSIONS, OPPORTUNITY_STALE_DAYS } from "../opportunities/constants.js";
import { OPPORTUNITY_SELECT, buildOpportunityListWhere, toOpportunity } from "../opportunities/records.js";
import { listOpportunityStages } from "../opportunities/stages.js";
import { ensureDefaultSalesPipeline } from "../sales-stages/defaults.js";

const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const CARDS_PER_STAGE = 50;

// How cards are ordered inside a stage. Expressions over the list query's columns (aliased "counted").
const CARD_SORTS = Object.freeze({
  expectedCloseDate: "counted.expected_close_date ASC NULLS LAST",
  amount: "counted.amount DESC",
  lastActivityAt: "COALESCE(counted.last_activity_at, counted.created_at) DESC",
  createdAt: "counted.created_at DESC",
  priority: "CASE counted.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END",
});

// The stage column a deal is shown in: its stage while open, the stage it
// was won or lost from once closed. Won and lost are outcomes, not columns.
const COLUMN = "CASE WHEN counted.status = 'open' THEN counted.stage_id ELSE COALESCE(counted.stage_before_close_id, counted.stage_id) END";

// The active board shows open deals; "won", "lost" and "all" are the historical views.
function boardFilters(filters) {
  const status = ["open", "won", "lost", "all"].includes(filters.status) ? filters.status : "open";
  return { ...filters, status: status === "all" ? undefined : status };
}

// filters: every filter the opportunity list accepts, plus
//   status         open (default) | won | lost | all
//   cardSort       expectedCloseDate (default) | amount | lastActivityAt | createdAt | priority
//   cardsPerStage  how many cards to return per stage (default 50, at most 200)
// Returns { stages: [{ …stage, count, value, weightedValue, averageDaysInStage, cards, hasMore }], total, totalValue, weightedValue, … }.
export async function getOpportunityPipeline(client, context, filters = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.view, "You do not have permission to view the pipeline.");
  await ensureDefaultSalesPipeline(client, context);
  const applied = boardFilters(filters);
  const cardSort = CARD_SORTS[filters.cardSort] ? filters.cardSort : "expectedCloseDate";
  const perStage = Math.min(Math.max(Number(filters.cardsPerStage) || CARDS_PER_STAGE, 1), 200);
  const values = [];
  const counted = `(${OPPORTUNITY_SELECT} ${buildOpportunityListWhere(context, applied, values)}) counted`;

  const totals = (await client.query(
    `SELECT ${COLUMN} AS column_id, count(*)::int AS total, COALESCE(sum(counted.amount), 0)::float8 AS value,
            COALESCE(sum(counted.amount * counted.probability / 100), 0)::float8 AS weighted,
            round(avg(counted.stage_age_days) FILTER (WHERE counted.status = 'open'), 1)::float8 AS average_days
       FROM ${counted}
      GROUP BY 1`,
    values,
  )).rows;
  const cards = (await client.query(
    `SELECT * FROM (
       SELECT counted.*, ${COLUMN} AS column_id, row_number() OVER (PARTITION BY ${COLUMN} ORDER BY ${CARD_SORTS[cardSort]}, counted.id) AS card_rank
         FROM ${counted}
     ) ranked
      WHERE ranked.card_rank <= ${perStage}
      ORDER BY ranked.column_id, ranked.card_rank`,
    values,
  )).rows;

  const stages = (await listOpportunityStages(client, context)).filter((stage) => stage.isOpen);
  // Deals can still sit in a stage that has since been deactivated; they keep their own column.
  const known = new Set(stages.map((stage) => stage.id));
  const orphaned = totals.map((row) => row.column_id).filter((id) => id && !known.has(id));
  if (orphaned.length) {
    const { rows } = await client.query(
      `SELECT id, code, name, sequence, probability FROM tenant.crm_pipeline_stages WHERE organization_id = $1 AND id = ANY ($2::uuid[]) AND NOT is_won AND NOT is_lost ORDER BY sequence`,
      [context.organizationId, orphaned],
    );
    for (const row of rows) stages.push({ id: row.id, code: row.code, name: row.name, sequence: row.sequence, probability: Number(row.probability), isInactive: true });
  }

  const totalsByStage = new Map(totals.map((row) => [row.column_id, row]));
  const columns = stages.map((stage) => {
    const row = totalsByStage.get(stage.id);
    const stageCards = cards.filter((card) => card.column_id === stage.id).map(toOpportunity);
    return {
      id: stage.id, code: stage.code, name: stage.name, sequence: stage.sequence, probability: stage.probability, isInactive: Boolean(stage.isInactive),
      count: row?.total ?? 0,
      value: money(row?.value),
      // estimated value × probability, summed over the stage
      weightedValue: money(row?.weighted),
      // how long the open deals in this stage have been there, on average
      averageDaysInStage: row?.average_days ?? null,
      cards: stageCards,
      hasMore: (row?.total ?? 0) > stageCards.length,
    };
  });
  return {
    status: applied.status ?? "all",
    cardSort,
    cardsPerStage: perStage,
    stages: columns,
    total: columns.reduce((sum, stage) => sum + stage.count, 0),
    totalValue: money(columns.reduce((sum, stage) => sum + stage.value, 0)),
    weightedValue: money(columns.reduce((sum, stage) => sum + stage.weightedValue, 0)),
    capabilities: opportunityCapabilities(context),
  };
}

// The figures above the board and the manager's breakdowns. Always about the
// open pipeline: the same filters as the board, with the status fixed to open.
// Returns { totals, byOwner, bySource, stageAging }.
export async function getPipelineSummary(client, context, filters = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.view, "You do not have permission to view the pipeline.");
  const open = { ...filters, status: "open", view: ["won", "lost", "archived"].includes(filters.view) ? "all" : filters.view };
  const values = [];
  const counted = `(${OPPORTUNITY_SELECT} ${buildOpportunityListWhere(context, open, values)}) counted`;
  const month = "date_trunc('month', current_date)";
  const closingThisMonth = `counted.expected_close_date >= ${month} AND counted.expected_close_date < ${month} + interval '1 month'`;

  const totals = (await client.query(
    `SELECT count(*)::int AS open, COALESCE(sum(counted.amount), 0)::float8 AS value,
            COALESCE(sum(counted.amount * counted.probability / 100), 0)::float8 AS weighted,
            count(*) FILTER (WHERE ${closingThisMonth})::int AS closing_this_month,
            COALESCE(sum(counted.amount) FILTER (WHERE ${closingThisMonth}), 0)::float8 AS closing_this_month_value,
            count(*) FILTER (WHERE counted.past_expected_close)::int AS overdue,
            count(*) FILTER (WHERE counted.days_since_activity >= ${OPPORTUNITY_STALE_DAYS})::int AS stale,
            count(*) FILTER (WHERE counted.next_activity_subject IS NULL)::int AS no_next_activity
       FROM ${counted}`,
    values,
  )).rows[0];

  const breakdown = async (key, label) => (await client.query(
    `SELECT ${key} AS id, ${label} AS label, count(*)::int AS total, COALESCE(sum(counted.amount), 0)::float8 AS value,
            COALESCE(sum(counted.amount * counted.probability / 100), 0)::float8 AS weighted
       FROM ${counted}
      GROUP BY 1, 2
      ORDER BY value DESC, label
      LIMIT 50`,
    values,
  )).rows.map((row) => ({ id: row.id, label: row.label, total: row.total, value: money(row.value), weightedValue: money(row.weighted) }));
  const byOwner = await breakdown("counted.owner_user_id", "COALESCE(counted.owner_name, 'Unassigned')");
  const bySource = await breakdown("counted.source_id", "COALESCE(counted.source_name, 'No source')");

  // Each owner's open deals by stage, for the team view.
  const ownerStages = (await client.query(
    `SELECT counted.owner_user_id AS owner_id, counted.stage_id, count(*)::int AS total, COALESCE(sum(counted.amount), 0)::float8 AS value
       FROM ${counted}
      GROUP BY 1, 2`,
    values,
  )).rows;
  for (const owner of byOwner)
    owner.stages = ownerStages.filter((row) => row.owner_id === owner.id).map((row) => ({ stageId: row.stage_id, total: row.total, value: money(row.value) }));

  // From the stage history of the deals the caller can see, over the last
  // year: how long deals stayed in each stage before moving on, and how many
  // of those that entered a stage went forward from it.
  const agingValues = [context.organizationId];
  const visible = opportunityScopeSql(context, agingValues, "opportunity");
  const aging = (await client.query(
    `SELECT spans.stage_id, count(*)::int AS entered, count(*) FILTER (WHERE spans.days IS NOT NULL)::int AS left_stage,
            round(avg(spans.days)::numeric, 1)::float8 AS average_days, count(*) FILTER (WHERE spans.moved_forward)::int AS moved_forward
       FROM (
         -- A close is an outcome, not a stage entry (it is recorded in the stage the deal closed in); a win counts as moving forward.
         SELECT history.to_stage_id AS stage_id, (stage.is_won OR stage.is_lost OR history.status IN ('won', 'lost')) AS is_outcome,
                EXTRACT(epoch FROM lead(history.changed_at) OVER moves - history.changed_at) / 86400 AS days,
                ((lead(stage.sequence) OVER moves > stage.sequence AND NOT lead(stage.is_lost) OVER moves AND lead(history.status) OVER moves IS DISTINCT FROM 'lost')
                  OR lead(history.status) OVER moves = 'won') AS moved_forward
           FROM tenant.crm_opportunity_stage_history history
           JOIN tenant.crm_pipeline_stages stage ON stage.organization_id = history.organization_id AND stage.id = history.to_stage_id
           JOIN tenant.crm_opportunities opportunity ON opportunity.organization_id = history.organization_id AND opportunity.id = history.opportunity_id
          WHERE history.organization_id = $1 AND history.changed_at >= now() - interval '365 days'${visible}
         WINDOW moves AS (PARTITION BY history.opportunity_id ORDER BY history.changed_at)
       ) spans
      WHERE NOT spans.is_outcome
      GROUP BY spans.stage_id`,
    agingValues,
  )).rows;

  return {
    totals: {
      open: totals.open,
      value: money(totals.value),
      weightedValue: money(totals.weighted),
      closingThisMonth: totals.closing_this_month,
      closingThisMonthValue: money(totals.closing_this_month_value),
      overdue: totals.overdue,
      stale: totals.stale,
      staleDays: OPPORTUNITY_STALE_DAYS,
      noNextActivity: totals.no_next_activity,
    },
    byOwner,
    bySource,
    stageAging: aging.map((row) => ({
      stageId: row.stage_id,
      entered: row.entered,
      // days a deal stayed in the stage before it moved on
      averageDays: row.average_days ?? null,
      // of the deals that left the stage, the share that went forward (to a later stage or won)
      conversionRate: row.left_stage ? Math.round((row.moved_forward / row.left_stage) * 1000) / 10 : null,
    })),
  };
}
