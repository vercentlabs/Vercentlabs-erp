import { createHash } from "node:crypto";

import { audit } from "../../../core/security/request-security.js";
import { canViewAllCrmResource, managedTeamMemberIds } from "../data-management/crm-access-scope.js";
import { CrmError } from "../data-management/errors.js";
import { queueOutboxEvent } from "../data-management/outbox.js";
import { camelizeRow } from "../data-management/record-utils.js";
import { METRIC_VERSION } from "./metric-definitions.js";
import { primaryTeamSql } from "./opportunity-facts.js";
import { getMetricRollup, getPipelineMetrics } from "./pipeline-metrics.js";

// F025 Sales forecast. Live figures come from the canonical metric layer
// (Commit / Best case / Pipeline are cumulative categories, see
// metric-definitions.js); submissions and manager adjustments sit on top and
// never change an opportunity. Rollup: every owner belongs to exactly one
// team (their primary membership on the as-of date), a team = its owners +
// its child teams, the organisation = every owner once — no double counting.
// Snapshots freeze the whole picture (organisation, team and owner rows plus
// each owner's deals) so history is reproduced, never recalculated. Money is
// summed in integer cents.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const today = () => new Date().toISOString().slice(0, 10);
const MEASURES = ["pipeline", "bestCase", "commit", "weighted", "won", "deals"];

const toCents = (value) => BigInt(Math.round(Number(value || 0) * 100));
const fromCents = (cents) => Number(cents) / 100;
function addFigures(target, source) {
  for (const key of MEASURES) {
    if (key === "deals") target.deals += source.deals;
    else target[key] = fromCents(toCents(target[key]) + toCents(source[key]));
  }
  return target;
}
const emptyFigures = () => ({ pipeline: 0, bestCase: 0, commit: 0, weighted: 0, won: 0, deals: 0 });

function has(context, permission) {
  return (context.roleSlugs || []).includes("organization_owner") || (context.permissions || []).includes(permission);
}

const periodClosed = (message = "This forecast period no longer accepts changes.") => new CrmError(409, message, "CRM_FORECAST_PERIOD_LOCKED");

async function loadPeriod(client, context, periodId, { lock = false } = {}) {
  if (!UUID.test(String(periodId || ""))) throw new CrmError(404, "Forecast period not found.", "CRM_FORECAST_PERIOD_NOT_FOUND");
  const parameters = [context.organizationId, periodId];
  const { rows } = await client.query(
    `SELECT id, organization_id, name, period_type, period_start::text AS period_start, period_end::text AS period_end, currency_code, status,
            frozen_at, closed_at, updated_at
       FROM tenant.crm_forecast_periods WHERE organization_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
    parameters,
  );
  if (!rows[0]) throw new CrmError(404, "Forecast period not found.", "CRM_FORECAST_PERIOD_NOT_FOUND");
  return rows[0];
}

// The organisation-wide view a snapshot records (visibility is applied when
// a snapshot is read, never when it is captured).
function systemView(context) {
  return Object.freeze({
    organizationId: context.organizationId,
    userId: context.userId ?? null,
    permissions: ["crm.records.view_all"],
    roleSlugs: ["system_worker"],
  });
}

async function ownerFigures(client, context, period, asOf) {
  const rollup = await getMetricRollup(client, context, {
    dimension: "owner",
    metrics: ["forecast_pipeline", "best_case", "commit", "weighted_closing", "won_amount", "closing_opportunities"],
    filters: { from: period.period_start, to: period.period_end, asOf },
  });
  return rollup.rows.map((row) => ({
    ownerUserId: row.key,
    ownerName: row.label,
    figures: {
      pipeline: row.values.forecast_pipeline,
      bestCase: row.values.best_case,
      commit: row.values.commit,
      weighted: row.values.weighted_closing,
      won: row.values.won_amount,
      deals: row.values.closing_opportunities,
    },
  }));
}

async function teamStructure(client, context, ownerIds, asOf) {
  const teams = await client.query(
    `SELECT id, name, parent_team_id, manager_user_id FROM tenant.crm_sales_teams WHERE organization_id=$1 AND status='active' ORDER BY name`,
    [context.organizationId],
  );
  const ids = ownerIds.filter((id) => UUID.test(String(id)));
  const primary = ids.length
    ? await client.query(
        `SELECT owner.id::text AS owner_id, ${primaryTeamSql("$1", "owner.id", "$3::date")}::text AS team_id FROM unnest($2::uuid[]) AS owner(id)`,
        [context.organizationId, ids, asOf],
      )
    : { rows: [] };
  return { teams: teams.rows.map(camelizeRow), ownerTeam: new Map(primary.rows.map((row) => [row.owner_id, row.team_id])) };
}

// Rep -> team -> parent team -> organisation, each owner counted once.
export function buildForecastRollup(teams, owners, ownerTeam) {
  const nodes = new Map(teams.map((team) => [String(team.id), { ...team, id: String(team.id), owners: [], children: [], figures: emptyFigures(), adjustedCommit: 0 }]));
  const unattributed = { owners: [], figures: emptyFigures(), adjustedCommit: 0 };
  const total = { figures: emptyFigures(), adjustedCommit: 0 };
  for (const owner of owners) {
    const node = nodes.get(String(ownerTeam.get(String(owner.ownerUserId)) ?? "")) ?? unattributed;
    node.owners.push(owner);
    addFigures(node.figures, owner.figures);
    node.adjustedCommit = fromCents(toCents(node.adjustedCommit) + toCents(owner.adjustedCommit));
    addFigures(total.figures, owner.figures);
    total.adjustedCommit = fromCents(toCents(total.adjustedCommit) + toCents(owner.adjustedCommit));
  }
  // Children roll into parents bottom-up (cycle-safe: each node is visited once).
  const roots = [];
  for (const node of nodes.values()) {
    const parent = node.parentTeamId ? nodes.get(String(node.parentTeamId)) : null;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  const visited = new Set();
  const settle = (node) => {
    if (visited.has(node.id)) return { figures: emptyFigures(), adjustedCommit: 0 };
    visited.add(node.id);
    const own = { figures: { ...node.figures }, adjustedCommit: node.adjustedCommit };
    for (const child of node.children) {
      const rolled = settle(child);
      addFigures(own.figures, rolled.figures);
      own.adjustedCommit = fromCents(toCents(own.adjustedCommit) + toCents(rolled.adjustedCommit));
    }
    node.rollup = own;
    return own;
  };
  for (const root of roots) settle(root);
  return { teams: roots, unattributed, total };
}

async function visibleSubmissions(client, context, periodId) {
  const { rows } = await client.query(
    `SELECT submission.*, owner.full_name AS owner_name, reviewer.full_name AS reviewer_name
       FROM tenant.crm_forecast_submissions submission
       LEFT JOIN public.users owner ON owner.id=submission.owner_user_id
       LEFT JOIN public.users reviewer ON reviewer.id=submission.reviewed_by
      WHERE submission.organization_id=$1 AND submission.period_id=$2 AND submission.status<>'superseded'
        AND submission.team_id IS NULL AND submission.territory_id IS NULL`,
    [context.organizationId, periodId],
  );
  if (canSeeAllForecasts(context)) return rows.map(camelizeRow);
  const managed = await managedTeamMemberIds(client, context);
  return rows.filter((row) => String(row.owner_user_id) === String(context.userId) || managed.has(String(row.owner_user_id))).map(camelizeRow);
}

function canSeeAllForecasts(context) {
  return canViewAllCrmResource(context, "opportunities") || has(context, "crm.forecast.manage");
}

/** The forecast workspace for one period: live figures, submissions and the rollup the caller may see. */
export async function getForecastWorkspace(client, context, { periodId, asOf } = {}) {
  const period = await loadPeriod(client, context, periodId);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(asOf || "")) ? String(asOf) : today();
  const owners = await ownerFigures(client, context, period, date);
  const submissions = await visibleSubmissions(client, context, period.id);
  const byOwner = new Map(submissions.map((row) => [String(row.ownerUserId), row]));
  for (const owner of owners) {
    const submission = byOwner.get(String(owner.ownerUserId)) ?? null;
    owner.submission = submission;
    const submittedCommit = submission ? Number(submission.commitAmount) : owner.figures.commit;
    owner.adjustedCommit = fromCents(toCents(submittedCommit) + toCents(submission?.managerAdjustment ?? 0));
  }
  const { teams, ownerTeam } = await teamStructure(client, context, owners.map((owner) => owner.ownerUserId), date);
  const rollup = buildForecastRollup(teams, owners, ownerTeam);
  const managed = await managedTeamMemberIds(client, context);
  const currency = await client.query(`SELECT base_currency FROM public.organizations WHERE id=$1`, [context.organizationId]);
  const captures = await client.query(
    `SELECT id, capture_key, source, as_of::text AS as_of, captured_at, row_count, metric_version FROM tenant.crm_forecast_snapshot_captures
      WHERE organization_id=$1 AND period_id=$2 ORDER BY captured_at DESC LIMIT 60`,
    [context.organizationId, period.id],
  );
  return {
    period: camelizeRow(period),
    asOf: date,
    metricVersion: METRIC_VERSION,
    reportingCurrency: currency.rows[0]?.base_currency ?? null,
    owners,
    rollup,
    captures: captures.rows.map(camelizeRow),
    permissions: {
      submit: has(context, "crm.forecast.submit") && period.status === "open",
      review: has(context, "crm.forecast.review") && period.status === "open",
      manage: has(context, "crm.forecast.manage"),
      reviewableOwners: canSeeAllForecasts(context) ? "all" : [...managed],
    },
  };
}

async function recordSubmissionEvent(client, context, submission, eventType, previousStatus, reason = null) {
  await client.query(
    `INSERT INTO tenant.crm_forecast_submission_events(organization_id,submission_id,period_id,event_type,previous_status,next_status,commit_amount,best_case_amount,manager_adjustment,reason,actor_user_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [context.organizationId, submission.id, submission.period_id, eventType, previousStatus, submission.status, submission.commit_amount, submission.best_case_amount, submission.manager_adjustment, reason, context.userId],
  );
}

function money(value, label, { allowNegative = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || (!allowNegative && number < 0) || Math.abs(number) >= 1e15)
    throw new CrmError(400, `${label} must be a valid amount.`, "CRM_FORECAST_AMOUNT_INVALID");
  if (Math.round(number * 100) / 100 !== number) throw new CrmError(400, `${label} can have at most two decimals.`, "CRM_FORECAST_AMOUNT_INVALID");
  return number;
}

/**
 * A seller submits their own forecast for an open period. The system figures
 * at that moment are kept as the submission's baseline. Resubmitting bumps
 * the version (optimistic concurrency) and clears any earlier review.
 */
export async function submitForecast(client, context, input = {}) {
  if (!has(context, "crm.forecast.submit")) throw new CrmError(403, "You cannot submit forecasts.", "CRM_PERMISSION_REQUIRED");
  const period = await loadPeriod(client, context, input.periodId, { lock: true });
  if (period.status !== "open") throw periodClosed();
  const commitAmount = money(input.commitAmount, "Commit");
  const bestCaseAmount = money(input.bestCaseAmount ?? commitAmount, "Best case");
  if (bestCaseAmount < commitAmount) throw new CrmError(400, "Best case cannot be lower than commit.", "CRM_FORECAST_BEST_CASE_BELOW_COMMIT");
  const notes = String(input.notes ?? "").trim();
  if (notes.length > 2000) throw new CrmError(400, "Notes can be up to 2000 characters.", "CRM_FORECAST_NOTES_TOO_LONG");
  const own = (await ownerFigures(client, { ...context, ownRecordsOnly: true }, period, today())).find((row) => String(row.ownerUserId) === String(context.userId));
  const baseline = { ...(own?.figures ?? emptyFigures()), metricVersion: METRIC_VERSION, asOf: today() };
  const existing = await client.query(
    `SELECT * FROM tenant.crm_forecast_submissions WHERE organization_id=$1 AND period_id=$2 AND owner_user_id=$3 AND team_id IS NULL AND territory_id IS NULL AND status<>'superseded' FOR UPDATE`,
    [context.organizationId, period.id, context.userId],
  );
  const current = existing.rows[0];
  if (current && input.expectedVersion !== undefined && Number(input.expectedVersion) !== Number(current.version))
    throw new CrmError(409, "Your forecast changed since you opened it. Refresh and try again.", "CRM_FORECAST_STALE_WRITE");
  if (current && Number(current.commit_amount) === commitAmount && Number(current.best_case_amount) === bestCaseAmount && (current.notes ?? "") === notes && current.status === "submitted")
    return { submission: camelizeRow(current), replayed: true };
  let row;
  if (current) {
    row = (
      await client.query(
        `UPDATE tenant.crm_forecast_submissions
            SET commit_amount=$3,best_case_amount=$4,pipeline_amount=$5,closed_amount=$6,notes=$7,baseline=$8::jsonb,currency_code=$9,
                status='submitted',submitted_by=$10,submitted_at=now(),manager_adjustment=0,adjustment_reason=NULL,review_notes=NULL,
                reviewed_by=NULL,reviewed_at=NULL,approved_by=NULL,approved_at=NULL,version=version+1,updated_by=$10,updated_at=now()
          WHERE organization_id=$1 AND id=$2 RETURNING *`,
        [context.organizationId, current.id, commitAmount, bestCaseAmount, baseline.pipeline, baseline.won, notes || null, JSON.stringify(baseline), period.currency_code, context.userId],
      )
    ).rows[0];
  } else {
    row = (
      await client.query(
        `INSERT INTO tenant.crm_forecast_submissions(organization_id,period_id,owner_user_id,submitted_by,pipeline_amount,best_case_amount,commit_amount,closed_amount,notes,baseline,currency_code,status,submitted_at,created_by,updated_by)
         VALUES($1,$2,$3,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,'submitted',now(),$3,$3) RETURNING *`,
        [context.organizationId, period.id, context.userId, baseline.pipeline, bestCaseAmount, commitAmount, baseline.won, notes || null, JSON.stringify(baseline), period.currency_code],
      )
    ).rows[0];
  }
  await recordSubmissionEvent(client, context, row, current ? "resubmitted" : "submitted", current?.status ?? null);
  await queueOutboxEvent(client, context, "crm.forecast.submitted", "forecast_submissions", row.id, { periodId: period.id, version: row.version });
  return { submission: camelizeRow(row), replayed: false };
}

/**
 * A manager approves, rejects or adjusts a team member's submission. The
 * adjustment is separate from the seller's number (adjusted commit =
 * submitted commit + adjustment) and always carries a reason. Only for
 * members of teams the reviewer manages, unless they see every forecast.
 */
export async function reviewForecast(client, context, input = {}) {
  if (!has(context, "crm.forecast.review")) throw new CrmError(403, "You cannot review forecasts.", "CRM_PERMISSION_REQUIRED");
  if (!UUID.test(String(input.submissionId || ""))) throw new CrmError(404, "Forecast submission not found.", "CRM_FORECAST_SUBMISSION_NOT_FOUND");
  const decision = String(input.decision || "");
  if (!["approve", "reject", "adjust"].includes(decision)) throw new CrmError(400, "Choose approve, reject or adjust.", "CRM_FORECAST_DECISION_INVALID");
  const { rows } = await client.query(`SELECT * FROM tenant.crm_forecast_submissions WHERE organization_id=$1 AND id=$2 AND status<>'superseded' FOR UPDATE`, [context.organizationId, input.submissionId]);
  const current = rows[0];
  if (!current) throw new CrmError(404, "Forecast submission not found.", "CRM_FORECAST_SUBMISSION_NOT_FOUND");
  const period = await loadPeriod(client, context, current.period_id, { lock: true });
  if (period.status !== "open") throw periodClosed();
  if (String(current.owner_user_id) === String(context.userId) && !has(context, "crm.forecast.manage"))
    throw new CrmError(403, "You cannot review your own forecast.", "CRM_FORECAST_SELF_REVIEW");
  if (!canSeeAllForecasts(context) && !(await managedTeamMemberIds(client, context)).has(String(current.owner_user_id)))
    throw new CrmError(404, "Forecast submission not found.", "CRM_FORECAST_SUBMISSION_NOT_FOUND");
  if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== Number(current.version))
    throw new CrmError(409, "This forecast changed since you opened it. Refresh and try again.", "CRM_FORECAST_STALE_WRITE");
  if (current.status === "draft") throw new CrmError(409, "Only a submitted forecast can be reviewed.", "CRM_FORECAST_NOT_SUBMITTED");
  const reason = String(input.reason ?? "").trim();
  if ((decision !== "approve" && reason.length < 3) || reason.length > 1000)
    throw new CrmError(400, "Give a reason (3–1000 characters).", "CRM_FORECAST_REASON_REQUIRED");
  let adjustment = Number(current.manager_adjustment || 0);
  if (decision === "adjust") adjustment = money(input.managerAdjustment, "Adjustment", { allowNegative: true });
  const status = decision === "reject" ? "rejected" : decision === "approve" ? "approved" : current.status;
  const updated = (
    await client.query(
      `UPDATE tenant.crm_forecast_submissions
          SET status=$3, manager_adjustment=$4, adjustment_reason=CASE WHEN $5 THEN $6 ELSE adjustment_reason END,
              review_notes=CASE WHEN $5 THEN review_notes ELSE $6 END, reviewed_by=$7, reviewed_at=now(),
              approved_by=CASE WHEN $3='approved' THEN $7 ELSE approved_by END, approved_at=CASE WHEN $3='approved' THEN now() ELSE approved_at END,
              version=version+1, updated_by=$7, updated_at=now()
        WHERE organization_id=$1 AND id=$2 RETURNING *`,
      [context.organizationId, current.id, status, adjustment, decision === "adjust", reason || null, context.userId],
    )
  ).rows[0];
  await recordSubmissionEvent(client, context, updated, decision === "adjust" ? "adjusted" : decision === "approve" ? "approved" : "rejected", current.status, reason || null);
  await audit(client, {
    organizationId: context.organizationId,
    actorUserId: context.userId,
    eventType: `crm.forecast.${decision === "adjust" ? "adjusted" : decision === "approve" ? "approved" : "rejected"}`,
    entityType: "crm.forecast_submission",
    entityId: current.id,
    beforeData: { status: current.status, managerAdjustment: Number(current.manager_adjustment || 0) },
    afterData: { status, managerAdjustment: adjustment },
    metadata: { reason: reason || null, periodId: period.id },
  });
  return { submission: camelizeRow(updated) };
}

export async function listForecastSubmissionEvents(client, context, submissionId) {
  const submissions = await client.query(`SELECT owner_user_id, period_id FROM tenant.crm_forecast_submissions WHERE organization_id=$1 AND id=$2`, [context.organizationId, submissionId]);
  const submission = submissions.rows[0];
  if (!submission) throw new CrmError(404, "Forecast submission not found.", "CRM_FORECAST_SUBMISSION_NOT_FOUND");
  if (!canSeeAllForecasts(context) && String(submission.owner_user_id) !== String(context.userId) && !(await managedTeamMemberIds(client, context)).has(String(submission.owner_user_id)))
    throw new CrmError(404, "Forecast submission not found.", "CRM_FORECAST_SUBMISSION_NOT_FOUND");
  const { rows } = await client.query(
    `SELECT event.*, actor.full_name AS actor_name FROM tenant.crm_forecast_submission_events event LEFT JOIN public.users actor ON actor.id=event.actor_user_id
      WHERE event.organization_id=$1 AND event.submission_id=$2 ORDER BY event.created_at, event.id`,
    [context.organizationId, submissionId],
  );
  return rows.map(camelizeRow);
}

/**
 * Captures an immutable snapshot of a period: an organisation row, one row
 * per team (rolled up) and one per owner with the deals behind it. The
 * capture key makes a retried or duplicate capture a no-op.
 */
export async function captureForecastPeriodSnapshot(client, context, { periodId, source = "manual", captureKey = null, asOf = null } = {}) {
  if (!["scheduled", "submission", "freeze", "close", "manual"].includes(source)) throw new CrmError(400, "Unknown snapshot source.", "CRM_FORECAST_SNAPSHOT_SOURCE_INVALID");
  const period = await loadPeriod(client, context, periodId);
  const date = asOf ?? today();
  const key = String(captureKey || `${source}:${new Date().toISOString()}`).slice(0, 120);
  const existing = await client.query(`SELECT * FROM tenant.crm_forecast_snapshot_captures WHERE organization_id=$1 AND period_id=$2 AND capture_key=$3`, [context.organizationId, period.id, key]);
  if (existing.rows[0]) return { capture: camelizeRow(existing.rows[0]), replayed: true };

  const view = systemView(context);
  const owners = await ownerFigures(client, view, period, date);
  const submissions = await client.query(
    `SELECT owner_user_id::text AS owner_user_id, commit_amount, manager_adjustment FROM tenant.crm_forecast_submissions
      WHERE organization_id=$1 AND period_id=$2 AND status<>'superseded' AND team_id IS NULL AND territory_id IS NULL`,
    [context.organizationId, period.id],
  );
  const submitted = new Map(submissions.rows.map((row) => [row.owner_user_id, row]));
  for (const owner of owners) {
    const submission = submitted.get(String(owner.ownerUserId));
    owner.submittedCommit = submission ? Number(submission.commit_amount) : null;
    owner.managerAdjustment = submission ? Number(submission.manager_adjustment || 0) : 0;
    owner.adjustedCommit = fromCents(toCents(owner.submittedCommit ?? owner.figures.commit) + toCents(owner.managerAdjustment));
  }
  const deals = await client.query(
    `SELECT opportunity.id, opportunity.owner_user_id::text AS owner_user_id, opportunity.name, opportunity.forecast_category, opportunity.status,
            opportunity.amount, opportunity.currency_code, opportunity.probability, opportunity.expected_close_date::text AS expected_close_date, stage.name AS stage_name
       FROM tenant.crm_opportunities opportunity
       LEFT JOIN tenant.crm_pipeline_stages stage ON stage.organization_id=opportunity.organization_id AND stage.id=opportunity.stage_id
      WHERE opportunity.organization_id=$1 AND opportunity.status='open' AND opportunity.forecast_category<>'omitted'
        AND opportunity.expected_close_date BETWEEN $2::date AND $3::date
      ORDER BY opportunity.id`,
    [context.organizationId, period.period_start, period.period_end],
  );
  const dealsByOwner = new Map();
  for (const deal of deals.rows) {
    const list = dealsByOwner.get(deal.owner_user_id ?? "") ?? [];
    list.push({ id: deal.id, name: deal.name, category: deal.forecast_category, amount: Number(deal.amount), currency: deal.currency_code, probability: Number(deal.probability), expectedCloseDate: deal.expected_close_date, stage: deal.stage_name });
    dealsByOwner.set(deal.owner_user_id ?? "", list);
  }
  const { teams, ownerTeam } = await teamStructure(client, view, owners.map((owner) => owner.ownerUserId), date);
  const rollup = buildForecastRollup(teams, owners, ownerTeam);
  const currency = (await client.query(`SELECT base_currency FROM public.organizations WHERE id=$1`, [context.organizationId])).rows[0]?.base_currency ?? null;

  const rows = [];
  const pushRow = (scopeType, scopeId, figures, extra = {}) =>
    rows.push({ scopeType, scopeId, figures, adjustedCommit: extra.adjustedCommit ?? figures.commit, ...extra });
  pushRow("organization", null, rollup.total.figures, { adjustedCommit: rollup.total.adjustedCommit });
  const walk = (node) => {
    pushRow("team", node.id, node.rollup.figures, { adjustedCommit: node.rollup.adjustedCommit, parentTeamId: node.parentTeamId ?? null, label: node.name });
    for (const child of node.children) walk(child);
  };
  for (const root of rollup.teams) walk(root);
  for (const owner of owners)
    pushRow("owner", owner.ownerUserId ?? null, owner.figures, {
      label: owner.ownerName,
      teamId: ownerTeam.get(String(owner.ownerUserId)) ?? null,
      submittedCommit: owner.submittedCommit,
      managerAdjustment: owner.managerAdjustment,
      adjustedCommit: owner.adjustedCommit,
      deals: dealsByOwner.get(String(owner.ownerUserId ?? "")) ?? [],
    });
  const contentHash = createHash("sha256").update(JSON.stringify({ periodId: period.id, asOf: date, metricVersion: METRIC_VERSION, rows })).digest("hex");
  const capture = (
    await client.query(
      `INSERT INTO tenant.crm_forecast_snapshot_captures(organization_id,period_id,capture_key,source,as_of,reporting_currency,metric_version,row_count,content_hash,captured_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (organization_id, period_id, capture_key) DO NOTHING RETURNING *`,
      [context.organizationId, period.id, key, source, date, currency, METRIC_VERSION, rows.length, contentHash, context.userId ?? null],
    )
  ).rows[0];
  if (!capture) {
    const winner = await client.query(`SELECT * FROM tenant.crm_forecast_snapshot_captures WHERE organization_id=$1 AND period_id=$2 AND capture_key=$3`, [context.organizationId, period.id, key]);
    return { capture: camelizeRow(winner.rows[0]), replayed: true };
  }
  for (const row of rows) {
    await client.query(
      `INSERT INTO tenant.crm_forecast_snapshots(organization_id,period_id,capture_id,snapshot_at,snapshot_type,scope_type,scope_id,owner_user_id,team_id,parent_team_id,currency_code,
         pipeline_amount,best_case_amount,commit_amount,weighted_amount,won_amount,submitted_commit,manager_adjustment,deal_count,totals,opportunity_snapshot,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21::jsonb,$22)`,
      [
        context.organizationId, period.id, capture.id, capture.captured_at, source, row.scopeType, row.scopeId,
        row.scopeType === "owner" ? row.scopeId : null, row.scopeType === "team" ? row.scopeId : row.teamId ?? null, row.parentTeamId ?? null, currency,
        row.figures.pipeline, row.figures.bestCase, row.figures.commit, row.figures.weighted, row.figures.won, row.submittedCommit ?? null, row.managerAdjustment ?? null, row.figures.deals,
        JSON.stringify({ label: row.label ?? null, adjustedCommit: row.adjustedCommit, metricVersion: METRIC_VERSION }), JSON.stringify(row.deals ?? []), context.userId ?? null,
      ],
    );
  }
  await queueOutboxEvent(client, context, "crm.forecast.snapshot_captured", "forecast_periods", period.id, { captureId: capture.id, source, rows: rows.length });
  return { capture: camelizeRow(capture), replayed: false };
}

/** Snapshot rows the caller may see: everything with forecast authority, else own rows and managed members' rows. */
export async function getForecastSnapshot(client, context, captureId) {
  if (!UUID.test(String(captureId || ""))) throw new CrmError(404, "Snapshot not found.", "CRM_FORECAST_SNAPSHOT_NOT_FOUND");
  const capture = (await client.query(`SELECT * FROM tenant.crm_forecast_snapshot_captures WHERE organization_id=$1 AND id=$2`, [context.organizationId, captureId])).rows[0];
  if (!capture) throw new CrmError(404, "Snapshot not found.", "CRM_FORECAST_SNAPSHOT_NOT_FOUND");
  await loadPeriod(client, context, capture.period_id);
  const { rows } = await client.query(
    `SELECT scope_type, scope_id, owner_user_id, team_id, parent_team_id, currency_code, pipeline_amount, best_case_amount, commit_amount, weighted_amount,
            won_amount, submitted_commit, manager_adjustment, deal_count, totals, opportunity_snapshot
       FROM tenant.crm_forecast_snapshots WHERE organization_id=$1 AND capture_id=$2
      ORDER BY CASE scope_type WHEN 'organization' THEN 0 WHEN 'team' THEN 1 ELSE 2 END, totals->>'label'`,
    [context.organizationId, captureId],
  );
  let visible = rows;
  if (!canSeeAllForecasts(context)) {
    const managed = await managedTeamMemberIds(client, context);
    const managedTeams = new Set((await client.query(`SELECT id::text FROM tenant.crm_sales_teams WHERE organization_id=$1 AND manager_user_id=$2`, [context.organizationId, context.userId])).rows.map((row) => row.id));
    visible = rows.filter(
      (row) =>
        (row.scope_type === "owner" && (String(row.owner_user_id) === String(context.userId) || managed.has(String(row.owner_user_id)))) ||
        (row.scope_type === "team" && managedTeams.has(String(row.team_id))),
    );
  }
  return { capture: camelizeRow(capture), rows: visible.map(camelizeRow) };
}

const PERIOD_TRANSITIONS = Object.freeze({ planned: ["open"], open: ["frozen"], frozen: ["open", "closed"], closed: [] });

/**
 * Period lifecycle: planned -> open -> frozen (locked) -> closed, with
 * frozen -> open allowed until close. Freezing and closing capture a
 * snapshot in the same transaction; closed is final (also enforced by the
 * database).
 */
export async function setForecastPeriodStatus(client, context, { periodId, status, expectedUpdatedAt } = {}) {
  if (!has(context, "crm.forecast.manage")) throw new CrmError(403, "You cannot govern forecast periods.", "CRM_PERMISSION_REQUIRED");
  const period = await loadPeriod(client, context, periodId, { lock: true });
  if (period.status === status) return { period: camelizeRow(period), replayed: true };
  if (!(PERIOD_TRANSITIONS[period.status] ?? []).includes(status))
    throw new CrmError(409, `A ${period.status} period cannot become ${status}.`, "CRM_FORECAST_PERIOD_TRANSITION_INVALID");
  if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== new Date(period.updated_at).getTime())
    throw new CrmError(409, "The period changed since you opened it. Refresh and try again.", "CRM_FORECAST_STALE_WRITE");
  let capture = null;
  if (status === "frozen" || status === "closed")
    capture = (await captureForecastPeriodSnapshot(client, context, { periodId: period.id, source: status === "closed" ? "close" : "freeze", captureKey: status === "closed" ? "close" : `freeze:${new Date().toISOString()}` })).capture;
  const updated = (
    await client.query(
      `UPDATE tenant.crm_forecast_periods
          SET status=$3, frozen_at=CASE WHEN $3='frozen' THEN now() ELSE frozen_at END, frozen_by=CASE WHEN $3='frozen' THEN $4 ELSE frozen_by END,
              closed_at=CASE WHEN $3='closed' THEN now() ELSE closed_at END, closed_by=CASE WHEN $3='closed' THEN $4 ELSE closed_by END,
              updated_by=$4, updated_at=now()
        WHERE organization_id=$1 AND id=$2 RETURNING *`,
      [context.organizationId, period.id, status, context.userId],
    )
  ).rows[0];
  await audit(client, {
    organizationId: context.organizationId,
    actorUserId: context.userId,
    eventType: "crm.forecast.period_status_changed",
    entityType: "crm.forecast_period",
    entityId: period.id,
    beforeData: { status: period.status },
    afterData: { status },
    metadata: { captureId: capture?.id ?? null },
  });
  return { period: camelizeRow(updated), capture };
}

/**
 * Accuracy of closed periods: the forecast captured at the horizon (the last
 * capture on or before period start + horizonDays, else the first capture in
 * the period) against what actually closed won in the period today, plus the
 * share of committed deals that were actually won. Organisation rows need
 * forecast authority; otherwise the caller's own owner rows are used.
 */
export async function getForecastAccuracy(client, context, { limit = 6, horizonDays = 0, ownerUserId = null } = {}) {
  const periods = Math.max(1, Math.min(24, Math.trunc(Number(limit)) || 6));
  const horizon = Math.max(0, Math.min(366, Math.trunc(Number(horizonDays)) || 0));
  const all = canSeeAllForecasts(context);
  const owner = all ? (ownerUserId && UUID.test(String(ownerUserId)) ? String(ownerUserId) : null) : context.userId;
  if (!all && ownerUserId && String(ownerUserId) !== String(context.userId)) throw new CrmError(403, "You can only see your own forecast accuracy.", "CRM_PERMISSION_REQUIRED");
  const parameters = [context.organizationId, periods, horizon, owner];
  const { rows } = await client.query(
    `WITH closed AS (
       SELECT period.* FROM tenant.crm_forecast_periods period
        WHERE period.organization_id=$1 AND period.status='closed'
        ORDER BY period.period_end DESC LIMIT $2),
     chosen AS (
       SELECT closed.id AS period_id, COALESCE(
         (SELECT capture.id FROM tenant.crm_forecast_snapshot_captures capture WHERE capture.organization_id=$1 AND capture.period_id=closed.id AND capture.as_of <= closed.period_start + $3::int ORDER BY capture.captured_at DESC LIMIT 1),
         (SELECT capture.id FROM tenant.crm_forecast_snapshot_captures capture WHERE capture.organization_id=$1 AND capture.period_id=closed.id ORDER BY capture.captured_at LIMIT 1)) AS capture_id
         FROM closed)
     SELECT closed.id AS period_id, closed.name, closed.period_start::text AS period_start, closed.period_end::text AS period_end,
            capture.id AS capture_id, capture.as_of::text AS captured_as_of, capture.source,
            snapshot.commit_amount, snapshot.best_case_amount, snapshot.pipeline_amount, snapshot.weighted_amount,
            (snapshot.totals->>'adjustedCommit')::numeric AS adjusted_commit, snapshot.opportunity_snapshot
       FROM closed
       JOIN chosen ON chosen.period_id=closed.id
       LEFT JOIN tenant.crm_forecast_snapshot_captures capture ON capture.organization_id=$1 AND capture.id=chosen.capture_id
       LEFT JOIN LATERAL (
         SELECT CASE WHEN $4::uuid IS NULL THEN max(s.commit_amount) FILTER (WHERE s.scope_type='organization') ELSE max(s.commit_amount) FILTER (WHERE s.owner_user_id=$4) END AS commit_amount,
                CASE WHEN $4::uuid IS NULL THEN max(s.best_case_amount) FILTER (WHERE s.scope_type='organization') ELSE max(s.best_case_amount) FILTER (WHERE s.owner_user_id=$4) END AS best_case_amount,
                CASE WHEN $4::uuid IS NULL THEN max(s.pipeline_amount) FILTER (WHERE s.scope_type='organization') ELSE max(s.pipeline_amount) FILTER (WHERE s.owner_user_id=$4) END AS pipeline_amount,
                CASE WHEN $4::uuid IS NULL THEN max(s.weighted_amount) FILTER (WHERE s.scope_type='organization') ELSE max(s.weighted_amount) FILTER (WHERE s.owner_user_id=$4) END AS weighted_amount,
                (array_agg(s.totals) FILTER (WHERE ($4::uuid IS NULL AND s.scope_type='organization') OR s.owner_user_id=$4))[1] AS totals,
                COALESCE(jsonb_agg(deal) FILTER (WHERE deal IS NOT NULL), '[]'::jsonb) AS opportunity_snapshot
           FROM tenant.crm_forecast_snapshots s
           LEFT JOIN LATERAL jsonb_array_elements(CASE WHEN s.scope_type='owner' AND ($4::uuid IS NULL OR s.owner_user_id=$4) THEN s.opportunity_snapshot ELSE '[]'::jsonb END) deal ON true
          WHERE s.organization_id=$1 AND s.capture_id=chosen.capture_id) snapshot ON true
      ORDER BY closed.period_end DESC`,
    parameters,
  );
  // Committed deals at capture time that were actually won in the period.
  const results = [];
  for (const row of rows) {
    const deals = Array.isArray(row.opportunity_snapshot) ? row.opportunity_snapshot : [];
    const committed = deals.filter((deal) => deal.category === "committed");
    let committedWon = 0;
    if (committed.length) {
      const won = await client.query(
        `SELECT count(*)::int AS count FROM tenant.crm_opportunities WHERE organization_id=$1 AND id = ANY($2::uuid[]) AND status='won' AND actual_close_date BETWEEN $3::date AND $4::date`,
        [context.organizationId, committed.map((deal) => deal.id), row.period_start, row.period_end],
      );
      committedWon = won.rows[0].count;
    }
    const forecast = row.capture_id ? Number(row.adjusted_commit ?? row.commit_amount ?? 0) : null;
    // Actual = the canonical Won metric for the period (converted, same
    // definition the dashboard uses), organisation-wide or for the owner.
    const actualView = all ? { ...context, permissions: [...(context.permissions || []), "crm.records.view_all"] } : context;
    const actual = (await getPipelineMetrics(client, actualView, { from: row.period_start, to: row.period_end, ...(owner ? { ownerId: owner } : {}) })).metrics.won_amount ?? 0;
    const errorAmount = forecast === null ? null : fromCents(toCents(actual) - toCents(forecast));
    results.push({
      periodId: row.period_id,
      name: row.name,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      captureId: row.capture_id,
      capturedAsOf: row.captured_as_of,
      source: row.source,
      forecastCommit: forecast,
      forecastBestCase: row.capture_id ? Number(row.best_case_amount ?? 0) : null,
      forecastWeighted: row.capture_id ? Number(row.weighted_amount ?? 0) : null,
      actualWon: actual,
      errorAmount,
      absoluteError: errorAmount === null ? null : Math.abs(errorAmount),
      errorPercent: forecast ? Math.round((errorAmount / forecast) * 10000) / 100 : null,
      commitDeals: committed.length,
      commitDealsWon: committedWon,
      commitConversionPercent: committed.length ? Math.round((committedWon / committed.length) * 10000) / 100 : null,
    });
  }
  const measured = results.filter((result) => result.errorPercent !== null);
  const calibration = measured.length
    ? {
        periods: measured.length,
        meanAbsolutePercentError: Math.round((measured.reduce((sum, result) => sum + Math.abs(result.errorPercent), 0) / measured.length) * 100) / 100,
        meanBiasPercent: Math.round((measured.reduce((sum, result) => sum + result.errorPercent, 0) / measured.length) * 100) / 100,
        withinTenPercent: measured.filter((result) => Math.abs(result.errorPercent) <= 10).length,
      }
    : { periods: 0, meanAbsolutePercentError: null, meanBiasPercent: null, withinTenPercent: 0 };
  return { scope: owner ? { ownerUserId: owner } : { organization: true }, horizonDays: horizon, periods: results, calibration };
}

/** Worker: capture today's scheduled snapshot for every open or frozen period that covers today. */
export async function captureScheduledForecastSnapshots(client, organizationId, { date = today() } = {}) {
  const context = Object.freeze({ organizationId, userId: null, permissions: ["crm.records.view_all"], roleSlugs: ["system_worker"] });
  const { rows } = await client.query(
    `SELECT id FROM tenant.crm_forecast_periods WHERE organization_id=$1 AND status IN ('open','frozen') AND period_start<=$2::date AND period_end>=$2::date ORDER BY period_start`,
    [organizationId, date],
  );
  let captured = 0;
  for (const row of rows) {
    const result = await captureForecastPeriodSnapshot(client, context, { periodId: row.id, source: "scheduled", captureKey: `scheduled:${date}`, asOf: date });
    if (!result.replayed) captured += 1;
  }
  return { periods: rows.length, captured };
}
