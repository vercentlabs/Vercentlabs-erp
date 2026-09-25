// F007 Lead lifecycle — the ONE governed command that may ever change a
// Lead's pipeline stage (crm_leads.status). Every write path — web, mobile,
// bulk, import, the stage-migration background job — MUST call this;
// nothing else is allowed to set crm_leads.status/stage_entered_at (see the
// crm_leads_stage_write_guard DB trigger, migration 093).
import { CrmError, queueOutboxEvent, text, dto, lifecycleError, projectLeadForContext, scopedLeadWhere, getLeadStage, isElevatedLifecycleActor } from "./shared.js";
import { listLeadStageHistory } from "./stage-catalog.js";
import { findApplicableTransitionReasons } from "./transition-graph.js";

export async function transitionLeadStage(client, context, leadId, input = {}, options = {}) {
  try {
    const targetValue = text(input.stageId || input.stageCode || input.status);
    if (!targetValue)
      throw new CrmError(400, "Choose a destination lifecycle stage.", "CRM_LEAD_STAGE_TARGET_REQUIRED");
    const values = [context.organizationId, leadId];
    const result = await client.query(
      `SELECT lead.*,current.id AS current_stage_id,current.name AS current_stage_name,current.status AS current_stage_status
         FROM tenant.crm_leads lead
         JOIN tenant.crm_lead_stages current ON current.organization_id=lead.organization_id AND current.code=lead.status
        WHERE lead.organization_id=$1 AND lead.id=$2${scopedLeadWhere(context, values)} FOR UPDATE OF lead`,
      values,
    );
    const lead = result.rows[0];
    if (!lead) throw new CrmError(404, "Lead not found.", "CRM_LEAD_NOT_FOUND");
    if (lead.record_status !== "active")
      throw new CrmError(409, `A ${lead.record_status} Lead cannot move lifecycle stage.`, "CRM_LEAD_STAGE_RECORD_CLOSED");
    const expectedUpdatedAt = text(input.expectedUpdatedAt);
    if (input.requireVersion === true && !expectedUpdatedAt)
      throw new CrmError(400, "Refresh this Lead before moving it.", "CRM_LEAD_VERSION_REQUIRED");
    if (expectedUpdatedAt) {
      const expected = new Date(expectedUpdatedAt);
      if (!Number.isFinite(expected.getTime()))
        throw new CrmError(400, "The Lead version is invalid. Refresh and try again.", "CRM_LEAD_VERSION_INVALID");
      if (expected.getTime() !== new Date(lead.updated_at).getTime())
        throw new CrmError(409, "This Lead changed after the board loaded. Refresh and try again.", "CRM_LEAD_STAGE_CONFLICT");
    }
    const target = await getLeadStage(client, context, targetValue);
    if (target.status !== "active")
      throw new CrmError(409, "Inactive stages cannot receive new transitions.", "CRM_LEAD_STAGE_INACTIVE");
    if (target.code === lead.status) {
      return { changed: false, record: projectLeadForContext(context, dto(lead)), stage: target, history: await listLeadStageHistory(client, context, leadId) };
    }
    let edgeExists = true;
    let reasonRequiredByEdge = false;
    if (!options.skipTransitionGraphCheck) {
      const allowed = await client.query(
        `SELECT reason_required FROM tenant.crm_lead_stage_transitions
         WHERE organization_id=$1 AND from_stage_id=$2 AND to_stage_id=$3`,
        [context.organizationId, lead.current_stage_id, target.id],
      );
      edgeExists = Boolean(allowed.rows[0]);
      reasonRequiredByEdge = Boolean(allowed.rows[0]?.reason_required);
    }
    let reasonCode = null;
    let reasonLabel = null;
    if (text(input.reasonCode)) {
      const applicable = await findApplicableTransitionReasons(client, context, lead.current_stage_id, target.id);
      const match = applicable.find((row) => row.code === text(input.reasonCode));
      if (!match)
        throw new CrmError(400, "That reason is not valid for this transition.", "CRM_LEAD_STAGE_REASON_INVALID");
      reasonCode = match.code;
      reasonLabel = match.label;
    }
    // F007 gap-closure — an elevated actor (organization owner or
    // crm.records.view_all) may move a Lead outside its configured graph
    // or past an unmet reason gate, mirroring the exact override shape
    // already used for manual lead assignment (F005) and qualification
    // (F006): explicit request + elevated permission + a written
    // justification of at least 3 characters, recorded on the immutable
    // event row itself rather than as a standing Lead property.
    const overrideRequested = input.overrideUsed === true;
    const overrideReasonText = overrideRequested ? text(input.overrideReason).slice(0, 1000) : "";
    let overrideUsed = false;
    const needsOverride = !edgeExists || (reasonRequiredByEdge && !reasonCode);
    if (needsOverride) {
      if (!overrideRequested) {
        if (!edgeExists)
          throw new CrmError(
            409,
            `Lead cannot move directly from ${lead.current_stage_name} to ${target.name}.`,
            "CRM_LEAD_STAGE_TRANSITION_INVALID",
          );
        throw new CrmError(
          400,
          `Moving from ${lead.current_stage_name} to ${target.name} requires a reason.`,
          "CRM_LEAD_STAGE_REASON_REQUIRED",
        );
      }
      if (!isElevatedLifecycleActor(context))
        throw new CrmError(
          403,
          "You do not have permission to move this Lead outside its normal lifecycle path.",
          "CRM_LEAD_STAGE_OVERRIDE_FORBIDDEN",
        );
      if (overrideReasonText.length < 3)
        throw new CrmError(
          400,
          "Explain why this Lead is moving outside its normal lifecycle path, in at least 3 characters.",
          "CRM_LEAD_STAGE_OVERRIDE_REASON_REQUIRED",
        );
      overrideUsed = true;
    }
    const source = options.source && ["manual", "kanban", "api", "legacy"].includes(String(options.source))
      ? String(options.source)
      : ["manual", "kanban", "api", "legacy"].includes(String(input.source))
        ? String(input.source)
        : "manual";
    const note = text(input.note) || null;
    if (note && note.length > 1000) throw new CrmError(400, "Transition note is too long.", "CRM_LEAD_STAGE_NOTE_INVALID");
    await client.query("SELECT set_config('app.crm_lead_stage_transition','allowed',true)");
    let updated;
    try {
      updated = await client.query(
        `UPDATE tenant.crm_leads SET status=$3,stage_entered_at=now(),dwell_breach_notified_at=NULL,updated_by=$4,updated_at=now()
         WHERE organization_id=$1 AND id=$2 RETURNING *`,
        [context.organizationId, leadId, target.code, context.userId],
      );
    } finally {
      await client.query("SELECT set_config('app.crm_lead_stage_transition','',true)");
    }
    const event = await client.query(
      `INSERT INTO tenant.crm_lead_stage_events(
         organization_id,lead_id,from_stage_id,to_stage_id,from_stage_code,to_stage_code,source,note,reason_code,reason_label,changed_by_user_id,override_used,override_reason
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        context.organizationId, leadId, lead.current_stage_id, target.id, lead.status, target.code, source, note,
        reasonCode, reasonLabel, context.userId, overrideUsed, overrideUsed ? overrideReasonText : null,
      ],
    );
    await queueOutboxEvent(client, context, "crm.lead.stage_changed", "leads", leadId, {
      before: { status: lead.status }, after: { status: target.code },
      changedFields: ["status"], eventId: event.rows[0].id, source, reasonCode, overrideUsed,
    });
    return {
      changed: true,
      record: projectLeadForContext(context, dto(updated.rows[0])),
      stage: target,
      event: dto(event.rows[0]),
      history: await listLeadStageHistory(client, context, leadId),
    };
  } catch (error) {
    throw lifecycleError(error);
  }
}
