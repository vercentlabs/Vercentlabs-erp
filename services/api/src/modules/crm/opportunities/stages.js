// Sales stages: where a deal is in the process (Discovery → Needs Analysis →
// Proposal → Negotiation → Closing). Stage is separate from status: a deal
// is won or lost through outcome.js, never by picking a stage.
//
// An open deal moves freely, forwards or backwards. Each stage carries a
// default probability, which the deal takes on unless someone has set its
// probability by hand. Every move is one row in the stage history.
import { createNotification } from "../../../core/platform/notifications/index.js";
import { CrmError } from "../data-management/errors.js";
import { queueOutboxEvent } from "../data-management/outbox.js";
import { requireOpportunityPermission } from "./access.js";
import { OPPORTUNITY_PERMISSIONS } from "./constants.js";
import { stageEntryBlockers, stageEntryWarnings, suggestedStageActions } from "../sales-stages/rules.js";
import { recordOpportunityHistory } from "./history.js";
import { assertNotStale, assertOpen, getOpportunity, lockOpportunity, requireUuid, toOpportunity, readOpportunityRow } from "./records.js";

const text = (value) => String(value ?? "").trim();

// The database refuses a change of stage, status or probability that does not
// come from one of the opportunity operations. This marks the write as one.
export async function withLifecycleWrite(client, work) {
  await client.query("SELECT set_config('app.crm_opportunity_lifecycle_transition', 'allowed', true)");
  try {
    return await work();
  } finally {
    await client.query("SELECT set_config('app.crm_opportunity_lifecycle_transition', '', true)");
  }
}

function toStage(row) {
  return {
    id: row.id, code: row.code, name: row.name, sequence: row.sequence, probability: Number(row.probability ?? 0), pipelineId: row.pipeline_id,
    description: row.description ?? null, guidance: row.guidance ?? null,
    // the actions worth putting forward while a deal is in this stage
    suggestedActions: suggestedStageActions(row),
    isWon: row.is_won, isLost: row.is_lost, isOpen: !row.is_won && !row.is_lost,
    openCount: row.open_count === undefined ? undefined : Number(row.open_count),
  };
}

// The stages of one pipeline (the default one unless pipelineId is given), in order.
export async function listOpportunityStages(client, context, { pipelineId = null } = {}) {
  const { rows } = await client.query(
    `SELECT stage.*, (SELECT count(*) FROM tenant.crm_opportunities opportunity
                       WHERE opportunity.organization_id = stage.organization_id AND opportunity.stage_id = stage.id AND opportunity.status = 'open'
                         AND opportunity.archived_at IS NULL) AS open_count
       FROM tenant.crm_pipeline_stages stage
       JOIN tenant.crm_pipelines pipeline ON pipeline.organization_id = stage.organization_id AND pipeline.id = stage.pipeline_id AND pipeline.status = 'active'
      WHERE stage.organization_id = $1 AND stage.status = 'active'
        AND ($2::uuid IS NOT NULL AND stage.pipeline_id = $2 OR $2::uuid IS NULL AND pipeline.is_default)
      ORDER BY stage.sequence`,
    [context.organizationId, pipelineId],
  );
  return rows.map(toStage);
}

export async function pipelineStage(client, context, pipelineId, stageId) {
  const { rows } = await client.query(
    `SELECT * FROM tenant.crm_pipeline_stages WHERE organization_id = $1 AND id = $2 AND pipeline_id = $3 AND status = 'active'`,
    [context.organizationId, requireUuid(stageId, "Sales stage"), pipelineId],
  );
  if (!rows[0]) throw new CrmError(409, "The selected stage is not part of this opportunity's pipeline.", "CRM_OPPORTUNITY_STAGE_INVALID");
  return rows[0];
}

export async function terminalStage(client, context, pipelineId, kind) {
  const { rows } = await client.query(
    `SELECT * FROM tenant.crm_pipeline_stages WHERE organization_id = $1 AND pipeline_id = $2 AND status = 'active' AND ${kind === "won" ? "is_won" : "is_lost"}
      ORDER BY sequence LIMIT 1`,
    [context.organizationId, pipelineId],
  );
  if (!rows[0]) throw new CrmError(409, `This pipeline has no ${kind} stage. Add one under CRM settings, Pipeline stages.`, "CRM_OPPORTUNITY_STAGE_MISSING");
  return rows[0];
}

// A question marked "must be answered before leaving this stage" (CRM
// settings, Playbooks) holds the deal in the stage until it is answered.
async function assertStageExitAllowed(client, context, opportunity) {
  const { rows } = await client.query(
    `SELECT question.prompt FROM tenant.crm_playbook_questions question
      WHERE question.organization_id = $1 AND question.stage_id = $2 AND question.status = 'active' AND question.blocks_stage_exit
        AND NOT EXISTS (SELECT 1 FROM tenant.crm_playbook_responses response
                         WHERE response.organization_id = question.organization_id AND response.question_id = question.id AND response.opportunity_id = $3
                           AND response.response IS NOT NULL AND response.response <> 'null'::jsonb)
      ORDER BY question.sequence`,
    [context.organizationId, opportunity.stage_id, opportunity.id],
  );
  if (rows.length)
    throw new CrmError(409, "Answer the required questions for this stage before moving the opportunity.", "CRM_OPPORTUNITY_STAGE_EXIT_BLOCKED", {
      missingRequirements: rows.map((row) => row.prompt),
    });
}

// Writes the stage, the stage history row and the audit entry. The caller has
// locked the row and decided the status. Returns the probability it set.
//   columns  other opportunity columns written with the move ({ column: value })
//   outcome  { reasonId, reasonLabel, notes } recorded on the history row of a closing move
export async function writeStage(client, context, opportunity, stage, { status = "open", note = null, probability = null, columns = {}, outcome = {} } = {}) {
  const nextProbability = probability ?? (status === "open" && opportunity.probability_overridden ? Number(opportunity.probability) : Number(stage.probability));
  const assignments = Object.entries(columns);
  await withLifecycleWrite(client, () => client.query(
    `UPDATE tenant.crm_opportunities
        SET stage_id = $3, probability = $4, forecast_category = $5, status = $6, stage_entered_at = now(), updated_by = $7
            ${assignments.map(([column], index) => `, ${column} = $${index + 8}`).join("")}
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, opportunity.id, stage.id, nextProbability, status === "open" ? stage.forecast_category : "closed", status, context.userId ?? null,
      ...assignments.map(([, value]) => value)],
  ));
  await client.query(
    `INSERT INTO tenant.crm_opportunity_stage_history (organization_id, opportunity_id, from_stage_id, to_stage_id, probability, changed_by, note, status,
                                                       outcome_reason_id, outcome_reason_label, outcome_notes, probability_before, changed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, clock_timestamp())`,
    [context.organizationId, opportunity.id, opportunity.stage_id, stage.id, nextProbability, context.userId ?? null, text(note).slice(0, 2000) || null, status,
      outcome.reasonId ?? null, outcome.reasonLabel ?? null, outcome.notes ?? null, Number(opportunity.probability ?? 0)],
  );
  return nextProbability;
}

// input: { stageId, note?, expectedUpdatedAt?, warn? }. Only sales stages: a deal
// is closed with Mark won or Mark lost. Any stage can follow any other,
// forwards or backwards, skipping freely.
//   warn: true  refuses with CRM_OPPORTUNITY_STAGE_WARNING when the move deserves a second
//               look (no quotation yet, nothing scheduled); the caller confirms and repeats
//               the call without it. Requirements are refused either way.
export async function changeOpportunityStage(client, context, opportunityId, input = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.changeStage, "You do not have permission to change the stage of opportunities.");
  const opportunity = await lockOpportunity(client, context, opportunityId);
  assertOpen(opportunity, "moved");
  assertNotStale(opportunity, input.expectedUpdatedAt);
  if (!input.stageId) throw new CrmError(400, "Choose a stage.", "CRM_OPPORTUNITY_STAGE_INVALID");
  if (opportunity.stage_id === input.stageId) return { changed: false };
  const stage = await pipelineStage(client, context, opportunity.pipeline_id, input.stageId);
  if (stage.is_won || stage.is_lost)
    throw new CrmError(409, `Use Mark ${stage.is_won ? "won" : "lost"} to close this opportunity.`, "CRM_OPPORTUNITY_STAGE_TERMINAL");
  await assertStageExitAllowed(client, context, opportunity);
  const blockers = stageEntryBlockers(opportunity, stage);
  if (blockers.length) throw new CrmError(409, blockers[0], "CRM_OPPORTUNITY_STAGE_REQUIREMENTS", { missingRequirements: blockers });
  const warnings = input.warn ? stageEntryWarnings(opportunity, stage) : [];
  if (warnings.length) throw new CrmError(409, warnings.join(" "), "CRM_OPPORTUNITY_STAGE_WARNING", { warnings, stageId: stage.id, stageName: stage.name });
  const probability = await writeStage(client, context, opportunity, stage, { note: input.note });
  await recordOpportunityHistory(client, context, opportunity.id, "stage_changed", `Stage: ${opportunity.stage_name} → ${stage.name}`, {
    from: opportunity.stage_id, to: stage.id, fromName: opportunity.stage_name, toName: stage.name, probabilityBefore: Number(opportunity.probability), probability,
    note: text(input.note).slice(0, 500) || null,
  });
  // One stage is worth a word to the owner: someone else brought their deal to the point of decision.
  if (String(stage.code).toUpperCase() === "CLOSING" && opportunity.owner_user_id && opportunity.owner_user_id !== context.userId)
    await createNotification(client, {
      organizationId: context.organizationId,
      userId: opportunity.owner_user_id,
      category: "crm_opportunity_stage",
      title: `Your opportunity reached ${stage.name}`,
      message: `${opportunity.name} (${opportunity.code})`,
      href: `/crm/opportunities/${opportunity.id}`,
      entityType: "opportunity",
      entityId: opportunity.id,
    });
  await queueOutboxEvent(client, context, "crm.opportunity.stage_changed", "opportunities", opportunity.id, { fromStageId: opportunity.stage_id, toStageId: stage.id });
  return { changed: true, probability };
}

// Overrides the stage's default probability for this deal. input: { probability, reason? }
export async function setOpportunityProbability(client, context, opportunityId, input = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.changeProbability, "You do not have permission to change the probability of opportunities.");
  const probability = Number(input.probability);
  if (!Number.isFinite(probability) || probability < 0 || probability > 100)
    throw new CrmError(400, "Enter a probability from 0 to 100.", "CRM_OPPORTUNITY_VALIDATION");
  const opportunity = await lockOpportunity(client, context, opportunityId);
  assertOpen(opportunity, "changed");
  assertNotStale(opportunity, input.expectedUpdatedAt);
  if (Number(opportunity.probability) === probability) return { changed: false };
  // Returning to the stage's own probability removes the override.
  const overridden = probability !== Number(opportunity.stage_probability);
  await withLifecycleWrite(client, () => client.query(
    `UPDATE tenant.crm_opportunities SET probability = $3, probability_overridden = $4, updated_by = $5 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, opportunity.id, probability, overridden, context.userId ?? null],
  ));
  await recordOpportunityHistory(client, context, opportunity.id, "probability_changed", `Probability: ${Number(opportunity.probability)}% → ${probability}%`, {
    from: Number(opportunity.probability), to: probability, reason: text(input.reason).slice(0, 500) || null,
  });
  return { changed: true };
}

// Runs one operation per opportunity; each succeeds or fails on its own.
export async function runOpportunityBulkOperation(client, opportunityIds, operation, context = null) {
  const ids = [...new Set(Array.isArray(opportunityIds) ? opportunityIds : [])];
  if (!ids.length) throw new CrmError(400, "Select at least one opportunity.", "CRM_OPPORTUNITY_VALIDATION");
  if (ids.length > 200) throw new CrmError(400, "Select up to 200 opportunities at a time.", "CRM_OPPORTUNITY_BULK_LIMIT");
  if (ids.length > 1 && context) requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.bulkUpdate, "You do not have permission to change several opportunities at once.");
  const results = [];
  for (const opportunityId of ids) {
    await client.query("SAVEPOINT opportunity_bulk_operation");
    try {
      const outcome = await operation(opportunityId);
      await client.query("RELEASE SAVEPOINT opportunity_bulk_operation");
      results.push({ opportunityId, ok: true, changed: outcome?.changed !== false });
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT opportunity_bulk_operation");
      if (!(error instanceof CrmError)) throw error;
      results.push({ opportunityId, ok: false, message: error.message });
    }
  }
  return { results, succeeded: results.filter((entry) => entry.ok).length, failed: results.filter((entry) => !entry.ok).length };
}

export async function bulkChangeOpportunityStage(client, context, input = {}) {
  return runOpportunityBulkOperation(client, input.opportunityIds, (id) => changeOpportunityStage(client, context, id, { stageId: input.stageId, note: input.note }), context);
}

// Each stage the deal has been in, newest first, with how long it stayed.
export async function listOpportunityStageHistory(client, context, opportunityId) {
  const opportunity = await getOpportunity(client, context, opportunityId);
  const { rows } = await client.query(
    `SELECT history.id, history.changed_at, history.note, history.status, history.probability, history.probability_before, history.outcome_reason_label, history.outcome_notes,
            from_stage.name AS from_name, to_stage.name AS to_name, actor.full_name AS changed_by_name,
            lead(history.changed_at) OVER (ORDER BY history.changed_at, history.id) AS left_at
       FROM tenant.crm_opportunity_stage_history history
       LEFT JOIN tenant.crm_pipeline_stages from_stage ON from_stage.id = history.from_stage_id
       LEFT JOIN tenant.crm_pipeline_stages to_stage ON to_stage.id = history.to_stage_id
       LEFT JOIN public.users actor ON actor.id = history.changed_by
      WHERE history.organization_id = $1 AND history.opportunity_id = $2
      ORDER BY history.changed_at DESC, history.id DESC`,
    [context.organizationId, opportunity.id],
  );
  return rows.map((row) => ({
    id: row.id, fromStageName: row.from_name ?? null, toStageName: row.to_name, status: row.status, probability: Number(row.probability ?? 0),
    probabilityBefore: row.probability_before === null ? null : Number(row.probability_before),
    note: row.note, outcomeReason: row.outcome_reason_label, outcomeNotes: row.outcome_notes, enteredAt: row.changed_at, leftAt: row.left_at,
    changedByName: row.changed_by_name ?? null,
  }));
}

export { readOpportunityRow, toOpportunity };
