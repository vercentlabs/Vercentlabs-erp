import { CrmError } from "../crm-data-operations-and-customization/errors.js";
import { runCrmAutomation } from "../crm-data-operations-and-customization/resource-mutation-service.js";
import { queueOutboxEvent } from "../crm-data-operations-and-customization/outbox.js";
import { recordScope } from "../crm-data-operations-and-customization/record-policy.js";
import { resources } from "../crm-data-operations-and-customization/resource-registry.js";
import { camelizeRow } from "../crm-data-operations-and-customization/record-utils.js";



export async function updateOpportunityProbability(
  client,
  context,
  opportunityId,
  probabilityValue,
  note = null,
  expectations = {},
) {
  const probability = Number(probabilityValue);
  if (
    !Number.isFinite(probability) ||
    probability < 0 ||
    probability > 100 ||
    Math.abs(probability * 100 - Math.round(probability * 100)) > 1e-8
  ) {
    throw new CrmError(
      400,
      "Probability must be between 0 and 100 with at most two decimal places.",
      "CRM_OPPORTUNITY_PROBABILITY_INVALID",
    );
  }
  const normalizedProbability = Math.round(probability * 100) / 100;
  const normalizedNote = String(note || "").trim() || null;
  if (normalizedNote && normalizedNote.length > 1000) {
    throw new CrmError(
      400,
      "Probability note must be 1000 characters or fewer.",
      "CRM_OPPORTUNITY_PROBABILITY_NOTE_INVALID",
    );
  }
  const opportunityParameters = [context.organizationId, opportunityId];
  const opportunityResult = await client.query(
    `SELECT record.* FROM tenant.crm_opportunities record WHERE record.organization_id = $1 AND record.id = $2${recordScope(resources.opportunities, context, opportunityParameters)} FOR UPDATE`,
    opportunityParameters,
  );
  const opportunity = opportunityResult.rows[0];
  if (!opportunity) throw new CrmError(404, "Opportunity not found.");
  if (String(opportunity.status) !== "open") {
    throw new CrmError(
      409,
      "Closed or archived Opportunities cannot change probability.",
      "CRM_OPPORTUNITY_PROBABILITY_CLOSED",
    );
  }
  const fromProbability = Number(opportunity.probability || 0);
  // Desired-state replay is safe even when the original response was lost and
  // the caller retries with the now-stale version token. No history/outbox or
  // version mutation is repeated when the requested probability is already true.
  if (fromProbability === normalizedProbability) {
    return { ...camelizeRow(opportunity), replayed: true };
  }
  if (
    !expectations.expectedUpdatedAt ||
    expectations.expectedProbability === undefined ||
    expectations.expectedProbability === null
  ) {
    throw new CrmError(
      409,
      "Refresh the opportunity before changing probability so the current version can be verified.",
      "CRM_PROBABILITY_VERSION_REQUIRED",
    );
  }
  if (
    new Date(opportunity.updated_at).toISOString() !==
      new Date(expectations.expectedUpdatedAt).toISOString()
  ) {
    throw new CrmError(
      409,
      "This opportunity changed while it was offline. Refresh it before changing probability.",
      "CRM_STALE_WRITE",
    );
  }
  if (
    Number(opportunity.probability) !== Number(expectations.expectedProbability)
  ) {
    throw new CrmError(
      409,
      "This opportunity probability has already changed. Refresh it before continuing.",
      "CRM_PROBABILITY_CONFLICT",
    );
  }
  await client.query("SELECT set_config('app.crm_opportunity_lifecycle_transition','allowed',true)");
  let result;
  try {
    result = await client.query(
      `UPDATE tenant.crm_opportunities
          SET probability=$1,updated_by=$2,updated_at=now()
        WHERE organization_id=$3 AND id=$4
        RETURNING *`,
      [normalizedProbability, context.userId, context.organizationId, opportunityId],
    );
  } finally {
    await client.query("SELECT set_config('app.crm_opportunity_lifecycle_transition','',true)");
  }
  const updated = camelizeRow(result.rows[0]);
  await client.query(
    `INSERT INTO tenant.crm_opportunity_probability_history
      (organization_id,opportunity_id,from_probability,to_probability,expected_revenue,note,changed_by,source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'manual_override')`,
    [
      context.organizationId,
      opportunityId,
      fromProbability,
      normalizedProbability,
      updated.expectedRevenue,
      normalizedNote,
      context.userId,
    ],
  );
  await queueOutboxEvent(
    client,
    context,
    "crm.opportunity.probability_changed",
    "opportunity",
    opportunityId,
    {
      fromProbability,
      toProbability: normalizedProbability,
      amount: Number(updated.amount || 0),
      currencyCode: updated.currencyCode || null,
      expectedRevenue: Number(updated.expectedRevenue || 0),
    },
  );
  return { ...updated, replayed: false };
}



export async function moveOpportunityStage(
  client,
  context,
  opportunityId,
  stageId,
  note = null,
  expectations = {},
) {
  const opportunityParameters = [context.organizationId, opportunityId];
  const opportunityResult = await client.query(
    `SELECT record.* FROM tenant.crm_opportunities record WHERE record.organization_id = $1 AND record.id = $2${recordScope(resources.opportunities, context, opportunityParameters)} FOR UPDATE`,
    opportunityParameters,
  );
  const opportunity = opportunityResult.rows[0];
  if (!opportunity) throw new CrmError(404, "Opportunity not found.");
  if (
    expectations.expectedUpdatedAt &&
    new Date(opportunity.updated_at).toISOString() !==
      new Date(expectations.expectedUpdatedAt).toISOString()
  ) {
    throw new CrmError(
      409,
      "This opportunity changed while it was offline. Refresh it before moving the stage.",
      "CRM_STALE_WRITE",
    );
  }
  if (
    expectations.expectedStageId &&
    opportunity.stage_id !== expectations.expectedStageId
  ) {
    throw new CrmError(
      409,
      "This opportunity is already in a different stage. Refresh it before continuing.",
      "CRM_STAGE_CONFLICT",
    );
  }
  // Replaying the current stage is a no-op. Archived records are permanently
  // read-only. Won/Lost records can only move again through the controlled
  // reopen path below (F009-FLOW-001/F026-FLOW-001: "controlled reopen
  // preserving prior close events").
  if (opportunity.stage_id === stageId) return camelizeRow(opportunity);
  const currentStatus = String(opportunity.status);
  const reopening = currentStatus === "won" || currentStatus === "lost";
  if (currentStatus !== "open" && !reopening) {
    throw new CrmError(
      409,
      "Archived opportunities cannot be reopened.",
      "CRM_OPPORTUNITY_ARCHIVED",
    );
  }

  const stageResult = await client.query(
    `SELECT * FROM tenant.crm_pipeline_stages WHERE organization_id = $1 AND id = $2 AND pipeline_id = $3 AND status = 'active'`,
    [context.organizationId, stageId, opportunity.pipeline_id],
  );
  const stage = stageResult.rows[0];
  if (!stage)
    throw new CrmError(
      409,
      "The selected stage is not part of this opportunity pipeline.",
    );
  const status = stage.is_won ? "won" : stage.is_lost ? "lost" : "open";
  const reopenReason = reopening ? String(note || "").trim() : null;
  if (reopening && status !== "open") {
    throw new CrmError(
      409,
      "A closed opportunity can only be reopened into an open pipeline stage.",
      "CRM_OPPORTUNITY_REOPEN_TARGET_INVALID",
    );
  }
  if (reopening && !reopenReason) {
    throw new CrmError(
      400,
      "Provide a reason before reopening this opportunity.",
      "CRM_OPPORTUNITY_REOPEN_REASON_REQUIRED",
    );
  }
  let outcomeReasonId = null;
  let outcomeNotes = null;
  let outcomeReasonLabel = null;
  if (status === "won" || status === "lost") {
    outcomeReasonId = expectations.outcomeReasonId || null;
    outcomeNotes =
      String(expectations.outcomeNotes || note || "").trim() || null;
    if (!outcomeReasonId) {
      throw new CrmError(
        400,
        `Select a ${status} reason before closing this opportunity.`,
        "CRM_OUTCOME_REASON_REQUIRED",
      );
    }
    const reasonResult = await client.query(
      `SELECT id,name,outcome_type FROM tenant.crm_lost_reasons WHERE organization_id=$1 AND id=$2 AND status='active'`,
      [context.organizationId, outcomeReasonId],
    );
    const reason = reasonResult.rows[0];
    if (!reason || ![status, "both"].includes(reason.outcome_type)) {
      throw new CrmError(
        409,
        `The selected reason is not valid for a ${status} opportunity.`,
        "CRM_OUTCOME_REASON_INVALID",
      );
    }
    outcomeReasonLabel = reason.name;
  }
  // F012 integrity closeout (Prompts 1-5): crm_playbook_questions already
  // had a real blocks_stage_exit flag (Prompt 1 schema) — the dossier's
  // stage-level "required fields/guidance" requirement — but no code
  // anywhere ever checked it. A question marked blocks_stage_exit=true did
  // nothing at all; Opportunities could leave the stage with zero required
  // questions answered. This is the same governed playbook infrastructure
  // used elsewhere (crm_playbook_responses), not a parallel system.
  const blockingQuestions = await client.query(
    `SELECT question.id, question.prompt
       FROM tenant.crm_playbook_questions question
      WHERE question.organization_id = $1
        AND question.stage_id = $2
        AND question.status = 'active'
        AND question.blocks_stage_exit = true
        AND NOT EXISTS (
          SELECT 1 FROM tenant.crm_playbook_responses response
           WHERE response.organization_id = question.organization_id
             AND response.question_id = question.id
             AND response.opportunity_id = $3
             AND response.response IS NOT NULL
             AND response.response <> 'null'::jsonb
        )
      ORDER BY question.sequence`,
    [context.organizationId, opportunity.stage_id, opportunityId],
  );
  if (blockingQuestions.rows[0]) {
    throw new CrmError(
      409,
      "Answer the required questions for this stage before moving the opportunity.",
      "CRM_OPPORTUNITY_STAGE_EXIT_BLOCKED",
      {
        missingRequirements: blockingQuestions.rows.map((row) => row.prompt),
      },
    );
  }
  await client.query("SELECT set_config('app.crm_opportunity_lifecycle_transition','allowed',true)");
  let result;
  try {
    result = await client.query(
      `UPDATE tenant.crm_opportunities
         SET stage_id = $1, probability = $2, forecast_category = $3, status = $4,
             stage_entered_at = now(),
             actual_close_date = CASE WHEN $4 IN ('won','lost') THEN current_date ELSE NULL END,
             outcome_reason_id = CASE WHEN $4 IN ('won','lost') THEN $5::uuid ELSE NULL::uuid END,
             outcome_notes = CASE WHEN $4 IN ('won','lost') THEN $6 ELSE NULL END,
             lost_reason_id = CASE WHEN $4='lost' THEN $5::uuid ELSE NULL::uuid END,
             loss_notes = CASE WHEN $4='lost' THEN $6 ELSE NULL END,
             updated_by = $7, updated_at = now()
       WHERE organization_id = $8 AND id = $9 RETURNING *`,
      [
        stageId,
        stage.probability,
        stage.forecast_category,
        status,
        outcomeReasonId,
        outcomeNotes,
        context.userId,
        context.organizationId,
        opportunityId,
      ],
    );
  } finally {
    await client.query("SELECT set_config('app.crm_opportunity_lifecycle_transition','',true)");
  }
  await client.query(
    `INSERT INTO tenant.crm_opportunity_stage_history
       (organization_id, opportunity_id, from_stage_id, to_stage_id, probability, changed_by, note,
        status, outcome_reason_id, outcome_reason_label, outcome_notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      context.organizationId,
      opportunityId,
      opportunity.stage_id,
      stageId,
      stage.probability,
      context.userId,
      note,
      status,
      outcomeReasonId,
      outcomeReasonLabel,
      outcomeNotes,
    ],
  );
  const updated = camelizeRow(result.rows[0]);
  // Integrity closeout (Prompts 1-5): this UPDATE above adopts the
  // destination stage's configured probability (or forces 0/100 on
  // Won/Lost) but previously never wrote a crm_opportunity_probability_
  // history row — an Opportunity moved through several stages showed zero
  // probability history unless a manual override also happened separately.
  // Every stage-driven probability change is now recorded with an explicit
  // source, distinguishing it from a manual override.
  const fromProbability = Number(opportunity.probability || 0);
  const toProbability = Number(updated.probability || 0);
  if (fromProbability !== toProbability) {
    const probabilitySource = reopening
      ? "reopen"
      : status === "won"
        ? "terminal_won"
        : status === "lost"
          ? "terminal_lost"
          : "stage_default";
    await client.query(
      `INSERT INTO tenant.crm_opportunity_probability_history
        (organization_id,opportunity_id,from_probability,to_probability,expected_revenue,note,changed_by,source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        context.organizationId,
        opportunityId,
        fromProbability,
        toProbability,
        Number(updated.expectedRevenue || 0),
        note,
        context.userId,
        probabilitySource,
      ],
    );
  }
  await runCrmAutomation(
    client,
    context,
    "opportunity.stage_changed",
    "opportunity",
    opportunityId,
    updated,
  );
  await queueOutboxEvent(
    client,
    context,
    "crm.opportunity.stage_changed",
    "opportunity",
    opportunityId,
    { fromStageId: opportunity.stage_id, toStageId: stageId, status },
  );
  if (reopening) {
    await queueOutboxEvent(
      client,
      context,
      "crm.opportunity.reopened",
      "opportunity",
      opportunityId,
      {
        previousStatus: currentStatus,
        previousOutcomeReasonId: opportunity.outcome_reason_id || opportunity.lost_reason_id || null,
        reopenReason,
        toStageId: stageId,
      },
    );
  }
  return updated;
}
