// How a deal ends: won, lost, and (carefully) reopened.
//
//   open ──mark won──▶ won     100%, won reason, final value, actual close date
//     │
//     └──mark lost──▶ lost ──reopen──▶ open     0%, lost reason, estimate kept
//
// Status says what happened; the close reason says why; the deal's stage
// stays the stage it closed in (its final stage). These are operations, not
// field edits. Every close is written to the close history, which keeps it
// through reopens and corrections, so reopening never erases an outcome.
import { createNotification } from "../../../core/platform/notifications/index.js";
import { CLOSE_REASON_PERMISSIONS } from "../close-reasons/constants.js";
import { requireCloseReason } from "../close-reasons/records.js";
import { scheduleFollowUp } from "../follow-ups/records.js";
import { settleOpenFollowUps } from "../follow-ups/lifecycle.js";
import { settleOpenTasks } from "../tasks/lifecycle.js";
import { CrmError } from "../data-management/errors.js";
import { queueOutboxEvent } from "../data-management/outbox.js";
import { opportunityScopeSql, requireOpportunityPermission } from "./access.js";
import { OPPORTUNITY_PERMISSIONS } from "./constants.js";
import { recordOpportunityHistory } from "./history.js";
import { assertNotStale, assertOpen, lockOpportunity, readOpportunityRow, requireUuid } from "./records.js";
import { changeOpportunityStage, pipelineStage, writeStage } from "./stages.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (value) => String(value ?? "").trim();
const can = (context, permission) => Boolean(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(permission));

async function today(client) {
  return (await client.query(`SELECT current_date::text AS today`)).rows[0].today;
}

// The owner hears about an outcome someone else recorded on their deal.
async function notifyOutcome(client, context, opportunity, title, message) {
  if (!opportunity.owner_user_id || opportunity.owner_user_id === context.userId) return;
  await createNotification(client, {
    organizationId: context.organizationId,
    userId: opportunity.owner_user_id,
    category: "crm_opportunity_outcome",
    title,
    message: `${opportunity.name} (${opportunity.code})${message ? `. ${message}` : ""}`,
    href: `/crm/opportunities/${opportunity.id}`,
    entityType: "opportunity",
    entityId: opportunity.id,
  });
}

// A quotation named as the winning one must be a quotation of this deal.
async function requireOwnQuotation(client, context, opportunity, quotationId) {
  const { rows } = await client.query(
    `SELECT id, quotation_number, lifecycle_status FROM tenant.sales_quotations WHERE organization_id = $1 AND id = $2 AND source_opportunity_id = $3`,
    [context.organizationId, requireUuid(quotationId, "Quotation"), opportunity.id],
  );
  if (!rows[0]) throw new CrmError(409, "Choose a quotation raised from this opportunity.", "CRM_OPPORTUNITY_QUOTATION_INVALID");
  if (rows[0].lifecycle_status === "cancelled") throw new CrmError(409, "A cancelled quotation cannot be the winning one.", "CRM_OPPORTUNITY_QUOTATION_INVALID");
  return rows[0];
}

// The date the deal really closed: today unless given, never in the future.
async function closeDateOf(client, value) {
  const now = await today(client);
  const closeDate = text(value).slice(0, 10) || now;
  if (!DATE.test(closeDate) || Number.isNaN(Date.parse(`${closeDate}T00:00:00Z`))) throw new CrmError(400, "Enter the date the deal closed.", "CRM_OPPORTUNITY_CLOSE_DATE_REQUIRED");
  if (closeDate > now) throw new CrmError(400, "The close date cannot be in the future.", "CRM_OPPORTUNITY_CLOSE_DATE_REQUIRED");
  return closeDate;
}

// The stage a deal closes in: its own stage, even if that stage was deactivated since.
async function currentStage(client, context, opportunity) {
  const { rows } = await client.query(`SELECT * FROM tenant.crm_pipeline_stages WHERE organization_id = $1 AND id = $2`, [context.organizationId, opportunity.stage_id]);
  if (!rows[0]) throw new CrmError(409, "This opportunity has no valid stage.", "CRM_OPPORTUNITY_STAGE_INVALID");
  return rows[0];
}

// The reason's own rules: an explanation, a competitor.
function checkReasonRules(reason, { notes, competitorName }) {
  if (reason.requires_notes && !notes)
    throw new CrmError(400, `Add a short explanation for "${reason.name}".`, reason.outcome_type === "won" ? "CRM_OPPORTUNITY_WON_NOTES_REQUIRED" : "CRM_OPPORTUNITY_LOST_NOTES_REQUIRED");
  if (reason.requires_competitor && !competitorName)
    throw new CrmError(400, "Enter the competitor the customer chose.", "CRM_OPPORTUNITY_COMPETITOR_REQUIRED");
}

async function recordClose(client, context, opportunity, entry) {
  await client.query(
    `INSERT INTO tenant.crm_opportunity_close_history (organization_id, opportunity_id, outcome, reason_id, reason_name, notes, competitor_name, duplicate_of_opportunity_id,
       final_stage_id, final_stage_name, estimated_value, final_value, winning_quotation_id, actual_close_date, closed_by, closed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, clock_timestamp())`,
    [context.organizationId, opportunity.id, entry.outcome, entry.reason.id, entry.reason.name, entry.notes, entry.competitorName, entry.duplicateOfId ?? null,
      opportunity.stage_id, opportunity.stage_name, Number(opportunity.amount ?? 0), entry.finalValue ?? null, entry.quotationId ?? null, entry.closeDate, context.userId ?? null],
  );
}

const moneyText = (value, currency) => `${currency ? `${currency.trim()} ` : ""}${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// ------------------------------------------------------------------ won

// input: { reasonId (required), actualCloseDate? (today), finalValue? (the estimate), winningQuotationId?, notes?, competitorName?,
//          expectedUpdatedAt?, openTasks?: "keep" | "cancel", openFollowUps?: "keep" | "cancel" }
// Open tasks on the deal are never removed silently: kept (a won deal may still need its handoff) or cancelled.
export async function markOpportunityWon(client, context, opportunityId, input = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.markWon, "You do not have permission to mark opportunities as won.");
  const opportunity = await lockOpportunity(client, context, opportunityId);
  if (opportunity.status === "won") throw new CrmError(409, "This opportunity is already won.", "CRM_OPPORTUNITY_ALREADY_CLOSED");
  assertOpen(opportunity, "marked won");
  assertNotStale(opportunity, input.expectedUpdatedAt);
  const reason = await requireCloseReason(client, context, input.reasonId, "won");
  const notes = text(input.notes).slice(0, 4000) || null;
  const competitorName = text(input.competitorName).slice(0, 200) || null;
  checkReasonRules(reason, { notes, competitorName });
  const closeDate = await closeDateOf(client, input.actualCloseDate);
  const finalValue = input.finalValue === undefined || input.finalValue === null || text(input.finalValue) === "" ? Number(opportunity.amount) : Number(input.finalValue);
  if (!Number.isFinite(finalValue) || finalValue < 0) throw new CrmError(400, "Enter a final deal value of zero or more.", "CRM_OPPORTUNITY_VALIDATION");
  const quotation = input.winningQuotationId ? await requireOwnQuotation(client, context, opportunity, input.winningQuotationId) : null;
  const stage = await currentStage(client, context, opportunity);

  // The deal stays in the stage it closed in.
  await writeStage(client, context, opportunity, stage, {
    status: "won", probability: 100, note: notes,
    columns: {
      stage_before_close_id: opportunity.stage_id, actual_close_date: closeDate, won_amount: finalValue, won_at: new Date(), won_by: context.userId ?? null,
      closed_at: new Date(), closed_by: context.userId ?? null, winning_quotation_id: quotation?.id ?? null, outcome_reason_id: reason.id, outcome_notes: notes,
      competitor_name: competitorName, lost_reason_id: null, loss_notes: null, duplicate_of_opportunity_id: null,
    },
    outcome: { reasonId: reason.id, reasonLabel: reason.name, notes },
  });
  await recordClose(client, context, opportunity, { outcome: "won", reason, notes, competitorName, finalValue, quotationId: quotation?.id, closeDate });
  await recordOpportunityHistory(client, context, opportunity.id, "won",
    `Opportunity marked Won — Reason: ${reason.name} — Final value: ${moneyText(finalValue, opportunity.currency_code)}${quotation ? ` — Quotation ${quotation.quotation_number}` : ""}`, {
      from: "open", to: "won", finalStage: opportunity.stage_name, closeDate, reasonId: reason.id, reason: reason.name, notes, competitorName,
      estimatedValue: Number(opportunity.amount), finalValue, quotationId: quotation?.id ?? null,
    });
  await settleOpenTasks(client, context, "opportunity", opportunity.id, { action: input.openTasks, reason: "Opportunity won" });
  await settleOpenFollowUps(client, context, "opportunity", opportunity.id, { action: input.openFollowUps, reason: "Opportunity won" });
  await notifyOutcome(client, context, opportunity, "Your opportunity was marked won", `Reason: ${reason.name}`);
  await queueOutboxEvent(client, context, "crm.opportunity.won", "opportunities", opportunity.id, { amount: finalValue, closeDate, reasonId: reason.id });
  return { status: "won" };
}

// ------------------------------------------------------------------ lost

// The opportunity a duplicate stands in for: visible to the caller, not itself.
async function requireOriginal(client, context, opportunity, originalId) {
  const values = [context.organizationId, requireUuid(originalId, "Original opportunity")];
  const { rows } = await client.query(
    `SELECT opportunity.id, opportunity.code FROM tenant.crm_opportunities opportunity
      WHERE opportunity.organization_id = $1 AND opportunity.id = $2${opportunityScopeSql(context, values, "opportunity")}`,
    values,
  );
  if (!rows[0] || rows[0].id === opportunity.id) throw new CrmError(400, "Choose the original opportunity this one duplicates.", "CRM_OPPORTUNITY_DUPLICATE_OF_INVALID");
  return rows[0];
}

// input: { reasonId (required), actualCloseDate? (today), notes?, competitorName?, duplicateOfOpportunityId?,
//          followUp?: { date, subject? } (for a reason that may come back), expectedUpdatedAt?, openTasks?, openFollowUps? }
export async function markOpportunityLost(client, context, opportunityId, input = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.markLost, "You do not have permission to mark opportunities as lost.");
  const opportunity = await lockOpportunity(client, context, opportunityId);
  if (opportunity.status === "lost") throw new CrmError(409, "This opportunity is already lost.", "CRM_OPPORTUNITY_ALREADY_CLOSED");
  assertOpen(opportunity, "marked lost");
  assertNotStale(opportunity, input.expectedUpdatedAt);
  const reason = await requireCloseReason(client, context, input.reasonId, "lost");
  const notes = text(input.notes).slice(0, 4000) || null;
  const competitorName = text(input.competitorName).slice(0, 200) || null;
  checkReasonRules(reason, { notes, competitorName });
  const closeDate = await closeDateOf(client, input.actualCloseDate);
  const original = input.duplicateOfOpportunityId ? await requireOriginal(client, context, opportunity, input.duplicateOfOpportunityId) : null;
  const followUpDate = text(input.followUp?.date).slice(0, 10);
  if (followUpDate && (!DATE.test(followUpDate) || followUpDate <= closeDate)) throw new CrmError(400, "Choose a future date for the follow-up.", "CRM_OPPORTUNITY_VALIDATION");
  const stage = await currentStage(client, context, opportunity);

  // The deal stays in the stage it was lost in, and keeps its estimated value.
  await writeStage(client, context, opportunity, stage, {
    status: "lost", probability: 0, note: notes,
    columns: {
      stage_before_close_id: opportunity.stage_id, actual_close_date: closeDate, lost_reason_id: reason.id, loss_notes: notes, outcome_reason_id: reason.id,
      outcome_notes: notes, competitor_name: competitorName, lost_at: new Date(), lost_by: context.userId ?? null, closed_at: new Date(), closed_by: context.userId ?? null,
      duplicate_of_opportunity_id: original?.id ?? null, won_amount: null, winning_quotation_id: null,
    },
    outcome: { reasonId: reason.id, reasonLabel: reason.name, notes },
  });
  await recordClose(client, context, opportunity, { outcome: "lost", reason, notes, competitorName, duplicateOfId: original?.id, closeDate });
  await recordOpportunityHistory(client, context, opportunity.id, "lost",
    `Opportunity marked Lost — Reason: ${reason.name}${competitorName ? ` — Competitor: ${competitorName}` : ""}${original ? ` — Duplicate of ${original.code}` : ""}`, {
      from: "open", to: "lost", finalStage: opportunity.stage_name, closeDate, reasonId: reason.id, reason: reason.name, notes, competitorName,
      duplicateOf: original?.id ?? null, estimatedValue: Number(opportunity.amount),
    });
  await settleOpenTasks(client, context, "opportunity", opportunity.id, { action: input.openTasks, reason: "Opportunity lost" });
  await settleOpenFollowUps(client, context, "opportunity", opportunity.id, { action: input.openFollowUps, reason: "Opportunity lost" });
  // A deal that may come back: a follow-up to revisit it later.
  let followUp = null;
  if (followUpDate)
    followUp = await scheduleFollowUp(client, context, {
      relatedType: "opportunity", relatedId: opportunity.id, type: "call", scheduledDate: followUpDate,
      subject: text(input.followUp.subject).slice(0, 200) || `Revisit ${opportunity.name} (lost: ${reason.name})`,
      notes: notes ? `Lost: ${reason.name}. ${notes}` : `Lost: ${reason.name}.`,
    });
  await notifyOutcome(client, context, opportunity, "Your opportunity was marked lost", `Reason: ${reason.name}`);
  await queueOutboxEvent(client, context, "crm.opportunity.lost", "opportunities", opportunity.id, { reasonId: reason.id });
  return { status: "lost", followUpId: followUp?.id ?? null };
}

// ------------------------------------------------------------------ reopen

// A lost deal can come back. A won deal only while nothing downstream
// depends on it: once it has a sales order or an accepted quotation, new work
// is a new opportunity. The earlier close stays in the close history.
// input: { reason (required), stageId? } — reopens in the stage it closed in unless another open stage is given.
export async function reopenOpportunity(client, context, opportunityId, input = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.reopen, "You do not have permission to reopen opportunities.");
  const opportunity = await lockOpportunity(client, context, opportunityId);
  if (opportunity.archived_at) throw new CrmError(409, "Restore this opportunity before reopening it.", "CRM_OPPORTUNITY_ARCHIVED");
  if (!["won", "lost"].includes(opportunity.status)) throw new CrmError(409, "This opportunity is already open.", "CRM_OPPORTUNITY_NOT_CLOSED");
  const reason = text(input.reason).slice(0, 500);
  if (!reason) throw new CrmError(400, "Explain why this opportunity is being reopened.", "CRM_OPPORTUNITY_REOPEN_REASON_REQUIRED");
  if (opportunity.status === "won") {
    const downstream = await client.query(
      `SELECT (SELECT count(*) FROM tenant.sales_orders WHERE organization_id = $1 AND source_opportunity_id = $2)::int AS orders,
              (SELECT count(*) FROM tenant.sales_quotations WHERE organization_id = $1 AND source_opportunity_id = $2 AND lifecycle_status IN ('accepted', 'converted'))::int AS accepted`,
      [context.organizationId, opportunity.id],
    );
    if (downstream.rows[0].orders > 0 || downstream.rows[0].accepted > 0)
      throw new CrmError(409, "This deal was won and has a sales order or an accepted quotation. Create a new opportunity for new work.", "CRM_OPPORTUNITY_WON_LOCKED");
  }
  const stageId = input.stageId || opportunity.stage_id;
  const stage = await pipelineStage(client, context, opportunity.pipeline_id, stageId);
  if (!stage || stage.is_won || stage.is_lost || stage.status !== "active") throw new CrmError(409, "Choose an open stage to reopen this opportunity into.", "CRM_OPPORTUNITY_STAGE_INVALID");

  await writeStage(client, context, opportunity, stage, {
    status: "open", probability: Number(stage.probability), note: `Reopened: ${reason}`,
    columns: {
      actual_close_date: null, lost_reason_id: null, loss_notes: null, outcome_reason_id: null, outcome_notes: null, competitor_name: null,
      won_amount: null, won_at: null, won_by: null, lost_at: null, lost_by: null, closed_at: null, closed_by: null, winning_quotation_id: null,
      duplicate_of_opportunity_id: null, stage_before_close_id: null, probability_overridden: false,
    },
  });
  await client.query(
    `UPDATE tenant.crm_opportunity_close_history SET reopened_at = clock_timestamp(), reopened_by = $3, reopen_reason = $4, reopened_to_stage_id = $5
      WHERE organization_id = $1 AND opportunity_id = $2 AND reopened_at IS NULL`,
    [context.organizationId, opportunity.id, context.userId ?? null, reason, stage.id],
  );
  await recordOpportunityHistory(client, context, opportunity.id, "reopened", `Opportunity reopened into ${stage.name}: ${reason}`, {
    from: opportunity.status, to: "open", reason, previousCloseDate: opportunity.actual_close_on ?? null, previousReason: opportunity.outcome_reason_name ?? opportunity.lost_reason_name ?? null,
    previousNotes: opportunity.outcome_notes ?? opportunity.loss_notes ?? null, previousCompetitor: opportunity.competitor_name ?? null,
    previousWonAmount: opportunity.won_amount === null ? null : Number(opportunity.won_amount), stage: stage.name,
  });
  await queueOutboxEvent(client, context, "crm.opportunity.reopened", "opportunities", opportunity.id, { from: opportunity.status });
  return { status: "open" };
}

// ------------------------------------------------------------------ correcting a close reason

// Corrects the reason (and its notes or competitor) of a closed opportunity.
// Needs its own permission and a reason for the correction; both values stay in the history.
// input: { reasonId, notes?, competitorName?, correctionReason }
export async function correctOpportunityCloseReason(client, context, opportunityId, input = {}) {
  if (!can(context, CLOSE_REASON_PERMISSIONS.correct)) throw new CrmError(403, "You do not have permission to correct the reason of a closed opportunity.", "PERMISSION_DENIED");
  const opportunity = await lockOpportunity(client, context, opportunityId);
  if (!["won", "lost"].includes(opportunity.status)) throw new CrmError(409, "Only a closed opportunity has a close reason to correct.", "CRM_OPPORTUNITY_NOT_CLOSED");
  const correctionReason = text(input.correctionReason).slice(0, 500);
  if (!correctionReason) throw new CrmError(400, "Explain why the reason is being corrected.", "CRM_OPPORTUNITY_CORRECTION_REASON_REQUIRED");
  const reason = await requireCloseReason(client, context, input.reasonId, opportunity.status);
  const notes = input.notes === undefined ? (opportunity.outcome_notes ?? opportunity.loss_notes ?? null) : text(input.notes).slice(0, 4000) || null;
  const competitorName = input.competitorName === undefined ? opportunity.competitor_name ?? null : text(input.competitorName).slice(0, 200) || null;
  checkReasonRules(reason, { notes, competitorName });
  const previous = opportunity.outcome_reason_name ?? opportunity.lost_reason_name ?? "none";
  await client.query("SELECT set_config('app.crm_opportunity_lifecycle_transition', 'allowed', true)");
  try {
    await client.query(
      `UPDATE tenant.crm_opportunities
          SET outcome_reason_id = $3, outcome_notes = $4, competitor_name = $5,
              lost_reason_id = CASE WHEN status = 'lost' THEN $3 ELSE lost_reason_id END, loss_notes = CASE WHEN status = 'lost' THEN $4 ELSE loss_notes END, updated_by = $6
        WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, opportunity.id, reason.id, notes, competitorName, context.userId ?? null],
    );
  } finally {
    await client.query("SELECT set_config('app.crm_opportunity_lifecycle_transition', '', true)");
  }
  await client.query(
    `UPDATE tenant.crm_opportunity_close_history SET reason_id = $3, reason_name = $4, notes = $5, competitor_name = $6, corrected_at = clock_timestamp(), corrected_by = $7, correction_reason = $8
      WHERE id = (SELECT id FROM tenant.crm_opportunity_close_history WHERE organization_id = $1 AND opportunity_id = $2 AND reopened_at IS NULL ORDER BY closed_at DESC LIMIT 1)`,
    [context.organizationId, opportunity.id, reason.id, reason.name, notes, competitorName, context.userId ?? null, correctionReason],
  );
  await recordOpportunityHistory(client, context, opportunity.id, "updated", `Close reason corrected: ${previous} → ${reason.name} (${correctionReason})`, {
    closeReason: { from: previous, to: reason.name }, correctionReason, notes, competitorName,
  });
  return { status: opportunity.status, reasonId: reason.id };
}

// Every close of the opportunity, newest first, with any reopen and correction.
export async function listOpportunityCloseHistory(client, context, opportunityId) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.view, "You do not have permission to view opportunities.");
  const opportunity = await readOpportunityRow(client, context, opportunityId);
  const { rows } = await client.query(
    `SELECT history.*, closer.full_name AS closed_by_name, reopener.full_name AS reopened_by_name, corrector.full_name AS corrected_by_name,
            reopen_stage.name AS reopened_to_stage_name, quote.quotation_number, original.code AS duplicate_of_code
       FROM tenant.crm_opportunity_close_history history
       LEFT JOIN public.users closer ON closer.id = history.closed_by
       LEFT JOIN public.users reopener ON reopener.id = history.reopened_by
       LEFT JOIN public.users corrector ON corrector.id = history.corrected_by
       LEFT JOIN tenant.crm_pipeline_stages reopen_stage ON reopen_stage.organization_id = history.organization_id AND reopen_stage.id = history.reopened_to_stage_id
       LEFT JOIN tenant.sales_quotations quote ON quote.organization_id = history.organization_id AND quote.id = history.winning_quotation_id
       LEFT JOIN tenant.crm_opportunities original ON original.organization_id = history.organization_id AND original.id = history.duplicate_of_opportunity_id
      WHERE history.organization_id = $1 AND history.opportunity_id = $2
      ORDER BY history.closed_at DESC`,
    [context.organizationId, opportunity.id],
  );
  return rows.map((row) => ({
    id: row.id, outcome: row.outcome, reasonId: row.reason_id, reasonName: row.reason_name, notes: row.notes, competitorName: row.competitor_name,
    duplicateOfOpportunityId: row.duplicate_of_opportunity_id, duplicateOfCode: row.duplicate_of_code ?? null,
    finalStageName: row.final_stage_name, estimatedValue: row.estimated_value === null ? null : Number(row.estimated_value),
    finalValue: row.final_value === null ? null : Number(row.final_value), winningQuotationId: row.winning_quotation_id, winningQuotationNumber: row.quotation_number ?? null,
    actualCloseDate: row.actual_close_date, closedByName: row.closed_by_name ?? null, closedAt: row.closed_at,
    correctedAt: row.corrected_at, correctedByName: row.corrected_by_name ?? null, correctionReason: row.correction_reason,
    reopenedAt: row.reopened_at, reopenedByName: row.reopened_by_name ?? null, reopenReason: row.reopen_reason, reopenedToStageName: row.reopened_to_stage_name ?? null,
  }));
}

// ------------------------------------------------------------------ one entry point for callers that move by stage

// Other modules (the pipeline board, offline sync) move a deal by naming a
// stage. A move to a sales stage changes stage; a closed deal moved to an
// open stage is reopened; closing needs its own action and reason.
// expectations: { expectedUpdatedAt?, outcomeReasonId?, outcomeNotes?, actualCloseDate?, finalValue?, competitorName? }
export async function moveOpportunityStage(client, context, opportunityId, stageId, note = null, expectations = {}) {
  const opportunity = await lockOpportunity(client, context, opportunityId);
  if (opportunity.stage_id === stageId && opportunity.status === "open") return opportunity;
  const stage = await pipelineStage(client, context, opportunity.pipeline_id, stageId);
  const notes = text(expectations.outcomeNotes || note) || undefined;
  if (opportunity.status !== "open") {
    if (stage.is_won || stage.is_lost)
      throw new CrmError(409, "A closed opportunity can only be reopened into an open pipeline stage.", "CRM_OPPORTUNITY_REOPEN_TARGET_INVALID");
    await reopenOpportunity(client, context, opportunityId, { stageId, reason: note });
  } else if (stage.is_won) {
    await markOpportunityWon(client, context, opportunityId, {
      reasonId: expectations.outcomeReasonId, actualCloseDate: expectations.actualCloseDate, finalValue: expectations.finalValue, notes,
      competitorName: expectations.competitorName, expectedUpdatedAt: expectations.expectedUpdatedAt,
    });
  } else if (stage.is_lost) {
    await markOpportunityLost(client, context, opportunityId, {
      reasonId: expectations.outcomeReasonId, actualCloseDate: expectations.actualCloseDate, notes, competitorName: expectations.competitorName,
      expectedUpdatedAt: expectations.expectedUpdatedAt,
    });
  } else {
    await changeOpportunityStage(client, context, opportunityId, { stageId, note, expectedUpdatedAt: expectations.expectedUpdatedAt });
  }
  return lockOpportunity(client, context, opportunityId);
}
