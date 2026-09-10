// F007 Lead lifecycle — the directed transition graph (crm_lead_stage_transitions)
// and its governed reason vocabulary (crm_lead_stage_transition_reasons).
// Replaces the old auto-generated bidirectional-adjacency model: an edge
// only exists if an admin explicitly created it (or it was seeded once by
// stage-catalog.js's ensureDefaultLeadStages for a brand-new org).
import { CrmError, queueOutboxEvent, dto, lifecycleError, text, getLeadStage } from "./shared.js";

export async function listLeadStageTransitions(client, context) {
  const result = await client.query(
    `SELECT edge.*,from_stage.name AS from_stage_name,from_stage.code AS from_stage_code,
            to_stage.name AS to_stage_name,to_stage.code AS to_stage_code
       FROM tenant.crm_lead_stage_transitions edge
       JOIN tenant.crm_lead_stages from_stage ON from_stage.organization_id=edge.organization_id AND from_stage.id=edge.from_stage_id
       JOIN tenant.crm_lead_stages to_stage ON to_stage.organization_id=edge.organization_id AND to_stage.id=edge.to_stage_id
      WHERE edge.organization_id=$1
      ORDER BY from_stage.sort_order,to_stage.sort_order`,
    [context.organizationId],
  );
  return result.rows.map(dto);
}

export async function addLeadStageTransition(client, context, fromStageId, toStageId, input = {}) {
  try {
    const from = text(fromStageId);
    const to = text(toStageId);
    if (!from || !to) throw new CrmError(400, "Choose both a source and destination stage.", "CRM_LEAD_STAGE_TRANSITION_INPUT_INVALID");
    if (from === to) throw new CrmError(409, "A stage cannot transition to itself.", "CRM_LEAD_STAGE_TRANSITION_SELF");
    await getLeadStage(client, context, from);
    await getLeadStage(client, context, to);
    const reasonRequired = input.reasonRequired === true;
    await client.query(
      `INSERT INTO tenant.crm_lead_stage_transitions(organization_id,from_stage_id,to_stage_id,reason_required,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$5)
       ON CONFLICT (organization_id,from_stage_id,to_stage_id)
       DO UPDATE SET reason_required=$4,updated_by=$5,updated_at=now()`,
      [context.organizationId, from, to, reasonRequired, context.userId],
    );
    await queueOutboxEvent(client, context, "crm.lead_stage_transition.added", "lead_stage_transition", from, {
      fromStageId: from, toStageId: to, reasonRequired,
    });
    return { fromStageId: from, toStageId: to, reasonRequired };
  } catch (error) {
    throw lifecycleError(error);
  }
}

export async function removeLeadStageTransition(client, context, fromStageId, toStageId) {
  try {
    const result = await client.query(
      `DELETE FROM tenant.crm_lead_stage_transitions WHERE organization_id=$1 AND from_stage_id=$2 AND to_stage_id=$3 RETURNING from_stage_id,to_stage_id`,
      [context.organizationId, fromStageId, toStageId],
    );
    if (!result.rows[0]) throw new CrmError(404, "That transition does not exist.", "CRM_LEAD_STAGE_TRANSITION_NOT_FOUND");
    await queueOutboxEvent(client, context, "crm.lead_stage_transition.removed", "lead_stage_transition", fromStageId, {
      fromStageId, toStageId,
    });
    return { removed: true };
  } catch (error) {
    throw lifecycleError(error);
  }
}

function normalizeReasonInput(input, { create = false } = {}) {
  const scopeType = text(input.scopeType);
  if (create && !["transition", "destination", "any"].includes(scopeType))
    throw new CrmError(400, "Choose a valid reason scope.", "CRM_LEAD_STAGE_REASON_SCOPE_INVALID");
  const fromStageId = scopeType === "transition" ? text(input.fromStageId) || null : null;
  const toStageId = scopeType !== "any" ? text(input.toStageId) || null : null;
  if (create) {
    if (scopeType === "transition" && (!fromStageId || !toStageId))
      throw new CrmError(400, "A transition-scoped reason needs both a source and destination stage.", "CRM_LEAD_STAGE_REASON_SCOPE_INVALID");
    if (scopeType === "destination" && !toStageId)
      throw new CrmError(400, "A destination-scoped reason needs a destination stage.", "CRM_LEAD_STAGE_REASON_SCOPE_INVALID");
  }
  const result = { scopeType, fromStageId, toStageId };
  if (create || Object.prototype.hasOwnProperty.call(input, "code")) {
    const code = text(input.code).toLowerCase();
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(code))
      throw new CrmError(400, "Reason code must be lowercase letters, numbers and underscores.", "CRM_LEAD_STAGE_REASON_CODE_INVALID");
    result.code = code;
  }
  if (create || Object.prototype.hasOwnProperty.call(input, "label")) {
    const label = text(input.label);
    if (!label || label.length > 160)
      throw new CrmError(400, "Reason label must contain 1 to 160 characters.", "CRM_LEAD_STAGE_REASON_LABEL_INVALID");
    result.label = label;
  }
  if (Object.prototype.hasOwnProperty.call(input, "sequence")) {
    const sequence = Number(input.sequence);
    if (!Number.isInteger(sequence) || sequence < 0 || sequence > 100000)
      throw new CrmError(400, "Sequence must be a whole number between 0 and 100000.", "CRM_LEAD_STAGE_REASON_SEQUENCE_INVALID");
    result.sequence = sequence;
  }
  return result;
}

export async function listLeadStageTransitionReasons(client, context) {
  const result = await client.query(
    `SELECT * FROM tenant.crm_lead_stage_transition_reasons WHERE organization_id=$1 ORDER BY scope_type,sequence,id`,
    [context.organizationId],
  );
  return result.rows.map(dto);
}

export async function createLeadStageTransitionReason(client, context, input = {}) {
  try {
    const value = normalizeReasonInput(input, { create: true });
    if (value.fromStageId) await getLeadStage(client, context, value.fromStageId);
    if (value.toStageId) await getLeadStage(client, context, value.toStageId);
    const created = await client.query(
      `INSERT INTO tenant.crm_lead_stage_transition_reasons(
         organization_id,scope_type,from_stage_id,to_stage_id,code,label,sequence,created_by,updated_by
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,
      [
        context.organizationId,
        value.scopeType,
        value.fromStageId,
        value.toStageId,
        value.code,
        value.label,
        value.sequence ?? 100,
        context.userId,
      ],
    );
    return dto(created.rows[0]);
  } catch (error) {
    throw lifecycleError(error);
  }
}

export async function setLeadStageTransitionReasonActive(client, context, id, active) {
  try {
    const result = await client.query(
      `UPDATE tenant.crm_lead_stage_transition_reasons SET status=$3,updated_by=$4,updated_at=now()
        WHERE organization_id=$1 AND id=$2 RETURNING *`,
      [context.organizationId, id, active ? "active" : "inactive", context.userId],
    );
    if (!result.rows[0]) throw new CrmError(404, "Reason not found.", "CRM_LEAD_STAGE_REASON_NOT_FOUND");
    return dto(result.rows[0]);
  } catch (error) {
    throw lifecycleError(error);
  }
}

// Precedence lookup used by transition-engine.js: transition-scoped reasons
// win over destination-scoped, which win over org-wide "any" reasons.
export async function findApplicableTransitionReasons(client, context, fromStageId, toStageId) {
  const result = await client.query(
    `SELECT * FROM tenant.crm_lead_stage_transition_reasons
      WHERE organization_id=$1 AND status='active' AND (
        (scope_type='transition' AND from_stage_id=$2 AND to_stage_id=$3)
        OR (scope_type='destination' AND to_stage_id=$3)
        OR (scope_type='any')
      )
      ORDER BY (scope_type='transition') DESC,(scope_type='destination') DESC,sequence,id`,
    [context.organizationId, fromStageId, toStageId],
  );
  return result.rows.map(dto);
}
