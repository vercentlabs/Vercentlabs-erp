// How a deal ends: won, lost, and (carefully) reopened.
//
//   open ──mark won──▶ won        (100%, with a close date and the final value)
//     │
//     └──mark lost──▶ lost ──reopen──▶ open      (0%, with a reason)
//
// These are operations, not field edits: winning and losing have
// consequences for the pipeline, the forecast and Sales. The deal moves to
// the pipeline's closed stage and remembers the stage it was in, so
// reopening returns it there. Nothing about the earlier outcome is erased:
// it stays in the stage history and the audit trail.
import { createNotification } from "../../../core/platform/notifications/index.js";
import { CrmError } from "../data-management/errors.js";
import { queueOutboxEvent } from "../data-management/outbox.js";
import { requireOpportunityPermission } from "./access.js";
import { DEFAULT_LOST_REASONS, OPPORTUNITY_PERMISSIONS } from "./constants.js";
import { recordOpportunityHistory } from "./history.js";
import { assertNotStale, assertOpen, isUuid, lockOpportunity, requireUuid } from "./records.js";
import { changeOpportunityStage, pipelineStage, terminalStage, writeStage } from "./stages.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (value) => String(value ?? "").trim();
const today = () => new Date().toISOString().slice(0, 10);

// ------------------------------------------------------------------ lost reasons

// Idempotent: adds the standard lost reasons an organization does not have yet.
export async function ensureDefaultLostReasons(client, context) {
  const existing = await client.query(`SELECT 1 FROM tenant.crm_lost_reasons WHERE organization_id = $1 AND outcome_type IN ('lost', 'both') LIMIT 1`, [context.organizationId]);
  if (existing.rows[0]) return;
  for (const [index, reason] of DEFAULT_LOST_REASONS.entries())
    await client.query(
      `INSERT INTO tenant.crm_lost_reasons (organization_id, name, code, category, outcome_type, sequence, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'lost', $5, $6, $6) ON CONFLICT (organization_id, code) DO NOTHING`,
      [context.organizationId, reason.name, reason.code, reason.category, (index + 1) * 10, context.userId ?? null],
    );
}

export async function listOpportunityLostReasons(client, context) {
  await ensureDefaultLostReasons(client, context);
  const { rows } = await client.query(
    `SELECT id, name, code, category FROM tenant.crm_lost_reasons
      WHERE organization_id = $1 AND status = 'active' AND outcome_type IN ('lost', 'both') ORDER BY sequence, name`,
    [context.organizationId],
  );
  return rows.map((row) => ({ id: row.id, name: row.name, code: row.code, category: row.category, requiresNotes: row.code === "other", asksCompetitor: row.category === "competition" }));
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
    `SELECT id, quotation_number FROM tenant.sales_quotations WHERE organization_id = $1 AND id = $2 AND source_opportunity_id = $3`,
    [context.organizationId, requireUuid(quotationId, "Quotation"), opportunity.id],
  );
  if (!rows[0]) throw new CrmError(409, "Choose a quotation raised from this opportunity.", "CRM_OPPORTUNITY_QUOTATION_INVALID");
  return rows[0];
}

// ------------------------------------------------------------------ won

// input: { actualCloseDate (required), finalValue?, winningQuotationId?, notes?, expectedUpdatedAt? }
export async function markOpportunityWon(client, context, opportunityId, input = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.markWon, "You do not have permission to mark opportunities as won.");
  const opportunity = await lockOpportunity(client, context, opportunityId);
  if (opportunity.status === "won") throw new CrmError(409, "This opportunity is already won.", "CRM_OPPORTUNITY_ALREADY_CLOSED");
  assertOpen(opportunity, "marked won");
  assertNotStale(opportunity, input.expectedUpdatedAt);
  const closeDate = text(input.actualCloseDate).slice(0, 10);
  if (!DATE.test(closeDate)) throw new CrmError(400, "Enter the date the deal was won.", "CRM_OPPORTUNITY_CLOSE_DATE_REQUIRED");
  if (closeDate > today()) throw new CrmError(400, "The close date cannot be in the future.", "CRM_OPPORTUNITY_CLOSE_DATE_REQUIRED");
  const finalValue = input.finalValue === undefined || input.finalValue === null || text(input.finalValue) === "" ? Number(opportunity.amount) : Number(input.finalValue);
  if (!Number.isFinite(finalValue) || finalValue < 0) throw new CrmError(400, "Enter a final deal value of zero or more.", "CRM_OPPORTUNITY_VALIDATION");
  const quotation = input.winningQuotationId ? await requireOwnQuotation(client, context, opportunity, input.winningQuotationId) : null;
  const notes = text(input.notes).slice(0, 4000) || null;
  const stage = await terminalStage(client, context, opportunity.pipeline_id, "won");

  await writeStage(client, context, opportunity, stage, {
    status: "won", probability: 100, note: notes,
    columns: {
      stage_before_close_id: opportunity.stage_id, actual_close_date: closeDate, won_amount: finalValue, won_at: new Date(), won_by: context.userId ?? null,
      closed_at: new Date(), winning_quotation_id: quotation?.id ?? null, outcome_notes: notes, outcome_reason_id: null, lost_reason_id: null, loss_notes: null,
    },
    outcome: { notes },
  });
  await recordOpportunityHistory(client, context, opportunity.id, "won", `Opportunity won${quotation ? ` with quotation ${quotation.quotation_number}` : ""}`, {
    from: "open", to: "won", stage: opportunity.stage_name, closeDate, estimatedValue: Number(opportunity.amount), finalValue, quotationId: quotation?.id ?? null, notes,
  });
  await notifyOutcome(client, context, opportunity, "Your opportunity was marked won", null);
  await queueOutboxEvent(client, context, "crm.opportunity.won", "opportunities", opportunity.id, { amount: finalValue, closeDate });
  return { status: "won" };
}

// ------------------------------------------------------------------ lost

// input: { reasonId (required), notes? (required for Other), competitorName?, expectedUpdatedAt? }
export async function markOpportunityLost(client, context, opportunityId, input = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.markLost, "You do not have permission to mark opportunities as lost.");
  const opportunity = await lockOpportunity(client, context, opportunityId);
  if (opportunity.status === "lost") throw new CrmError(409, "This opportunity is already lost.", "CRM_OPPORTUNITY_ALREADY_CLOSED");
  assertOpen(opportunity, "marked lost");
  assertNotStale(opportunity, input.expectedUpdatedAt);
  if (!isUuid(input.reasonId)) throw new CrmError(400, "Choose why this opportunity was lost.", "CRM_OPPORTUNITY_LOST_REASON_REQUIRED");
  const reason = (await client.query(
    `SELECT id, name, code FROM tenant.crm_lost_reasons WHERE organization_id = $1 AND id = $2 AND status = 'active' AND outcome_type IN ('lost', 'both')`,
    [context.organizationId, input.reasonId],
  )).rows[0];
  if (!reason) throw new CrmError(400, "Choose why this opportunity was lost.", "CRM_OPPORTUNITY_LOST_REASON_REQUIRED");
  const notes = text(input.notes).slice(0, 4000) || null;
  if (reason.code === "other" && !notes) throw new CrmError(400, "Add a note explaining the reason.", "CRM_OPPORTUNITY_LOST_NOTES_REQUIRED");
  const competitorName = text(input.competitorName).slice(0, 200) || null;
  const stage = await terminalStage(client, context, opportunity.pipeline_id, "lost");

  await writeStage(client, context, opportunity, stage, {
    status: "lost", probability: 0, note: notes,
    columns: {
      stage_before_close_id: opportunity.stage_id, actual_close_date: today(), lost_reason_id: reason.id, loss_notes: notes, outcome_reason_id: reason.id,
      outcome_notes: notes, competitor_name: competitorName, lost_at: new Date(), lost_by: context.userId ?? null, closed_at: new Date(),
    },
    outcome: { reasonId: reason.id, reasonLabel: reason.name, notes },
  });
  await recordOpportunityHistory(client, context, opportunity.id, "lost", `Opportunity lost — ${reason.name}`, {
    from: "open", to: "lost", stage: opportunity.stage_name, reason: reason.name, reasonId: reason.id, notes, competitorName, estimatedValue: Number(opportunity.amount),
  });
  await notifyOutcome(client, context, opportunity, "Your opportunity was marked lost", `Reason: ${reason.name}`);
  await queueOutboxEvent(client, context, "crm.opportunity.lost", "opportunities", opportunity.id, { reasonId: reason.id });
  return { status: "lost" };
}

// ------------------------------------------------------------------ reopen

// A lost deal can come back. A won deal only while nothing downstream
// depends on it: once it has a sales order, new work is a new opportunity.
// input: { reason (required), stageId? } — returns to the stage it was closed from unless another is given.
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
  const stageId = input.stageId || opportunity.stage_before_close_id;
  const stage = stageId
    ? await pipelineStage(client, context, opportunity.pipeline_id, stageId)
    : (await client.query(
        `SELECT * FROM tenant.crm_pipeline_stages WHERE organization_id = $1 AND pipeline_id = $2 AND status = 'active' AND NOT is_won AND NOT is_lost ORDER BY sequence LIMIT 1`,
        [context.organizationId, opportunity.pipeline_id],
      )).rows[0];
  if (!stage || stage.is_won || stage.is_lost) throw new CrmError(409, "Choose an open stage to reopen this opportunity into.", "CRM_OPPORTUNITY_STAGE_INVALID");

  await writeStage(client, context, opportunity, stage, {
    status: "open", probability: Number(stage.probability), note: `Reopened: ${reason}`,
    columns: {
      actual_close_date: null, lost_reason_id: null, loss_notes: null, outcome_reason_id: null, outcome_notes: null, competitor_name: null,
      won_amount: null, won_at: null, won_by: null, lost_at: null, lost_by: null, closed_at: null, winning_quotation_id: null,
      stage_before_close_id: null, probability_overridden: false,
    },
  });
  // The previous outcome is kept here, in the audit trail, not on the record.
  await recordOpportunityHistory(client, context, opportunity.id, "reopened", `Opportunity reopened into ${stage.name}`, {
    from: opportunity.status, to: "open", reason, previousCloseDate: opportunity.actual_close_on ?? null, previousLostReason: opportunity.lost_reason_name ?? null,
    previousLossNotes: opportunity.loss_notes ?? null, previousWonAmount: opportunity.won_amount === null ? null : Number(opportunity.won_amount), stage: stage.name,
  });
  await queueOutboxEvent(client, context, "crm.opportunity.reopened", "opportunities", opportunity.id, { from: opportunity.status });
  return { status: "open" };
}

// ------------------------------------------------------------------ one entry point for callers that move by stage

// Other modules (the pipeline board, offline sync, the sales-order hand-off)
// move a deal by naming a stage, including the closed ones. This routes each
// such move to the operation that owns it.
// expectations: { expectedUpdatedAt?, outcomeReasonId?, outcomeNotes?, actualCloseDate?, finalValue?, competitorName? }
export async function moveOpportunityStage(client, context, opportunityId, stageId, note = null, expectations = {}) {
  const opportunity = await lockOpportunity(client, context, opportunityId);
  if (opportunity.stage_id === stageId) return opportunity;
  const stage = await pipelineStage(client, context, opportunity.pipeline_id, stageId);
  const notes = text(expectations.outcomeNotes || note) || undefined;
  if (opportunity.status !== "open") {
    if (stage.is_won || stage.is_lost)
      throw new CrmError(409, "A closed opportunity can only be reopened into an open pipeline stage.", "CRM_OPPORTUNITY_REOPEN_TARGET_INVALID");
    await reopenOpportunity(client, context, opportunityId, { stageId, reason: note });
  } else if (stage.is_won) {
    await markOpportunityWon(client, context, opportunityId, {
      actualCloseDate: expectations.actualCloseDate || today(), finalValue: expectations.finalValue, notes, expectedUpdatedAt: expectations.expectedUpdatedAt,
    });
  } else if (stage.is_lost) {
    await markOpportunityLost(client, context, opportunityId, {
      reasonId: expectations.outcomeReasonId, notes, competitorName: expectations.competitorName, expectedUpdatedAt: expectations.expectedUpdatedAt,
    });
  } else {
    await changeOpportunityStage(client, context, opportunityId, { stageId, note, expectedUpdatedAt: expectations.expectedUpdatedAt });
  }
  return lockOpportunity(client, context, opportunityId);
}
