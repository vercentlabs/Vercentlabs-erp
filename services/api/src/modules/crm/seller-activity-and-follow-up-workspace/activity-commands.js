import { CrmError } from "../crm-data-operations-and-customization/errors.js";
import { queueOutboxEvent } from "../crm-data-operations-and-customization/outbox.js";
import { recordScope } from "../crm-data-operations-and-customization/record-policy.js";
import { resources } from "../crm-data-operations-and-customization/resource-registry.js";
import { camelizeRow } from "../crm-data-operations-and-customization/record-utils.js";



export async function completeCrmActivity(
  client,
  context,
  activityId,
  outcome = null,
  expectations = {},
) {
  const parameters = [context.organizationId, activityId];
  const currentResult = await client.query(
    `SELECT record.*
       FROM tenant.crm_activities record
      WHERE record.organization_id = $1 AND record.id = $2${recordScope(resources.activities, context, parameters)}
      FOR UPDATE`,
    parameters,
  );
  const current = currentResult.rows[0];
  if (!current) throw new CrmError(404, "Activity not found.");
  if (current.activity_type === "call")
    throw new CrmError(410, "Use the governed Call completion action.", "CRM_CALL_API_MOVED");
  if (current.activity_type === "meeting")
    throw new CrmError(410, "Use the governed Meeting completion action.", "CRM_MEETING_API_MOVED");
  if (current.activity_type === "follow_up")
    throw new CrmError(410, "Use the governed Follow-up completion action.", "CRM_FOLLOW_UP_API_MOVED");
  // Checkpoint audit (Prompt 3 continuation): task was the one activity_type
  // this generic completion command did not redirect, even though it is
  // exactly as governed as Calls/Meetings/Follow-ups here (completeCrmTask
  // in task-operations.js additionally enforces dependency-blocked
  // completion and recurrence generation, neither of which this function
  // knows about) — calling completeCrmActivity() on a task id would have
  // silently completed a Task with incomplete dependencies.
  if (current.activity_type === "task")
    throw new CrmError(410, "Use the governed Task completion action.", "CRM_TASK_API_MOVED");
  if (
    expectations.expectedUpdatedAt &&
    new Date(current.updated_at).toISOString() !==
      new Date(expectations.expectedUpdatedAt).toISOString()
  ) {
    throw new CrmError(
      409,
      "This activity changed while it was offline. Refresh it before completing it.",
      "CRM_STALE_WRITE",
    );
  }
  if (
    expectations.expectedStatus &&
    current.status !== expectations.expectedStatus
  ) {
    throw new CrmError(
      409,
      "This activity is no longer in the expected status. Refresh it before continuing.",
      "CRM_ACTIVITY_CONFLICT",
    );
  }
  if (current.status === "completed") {
    throw new CrmError(
      409,
      "This activity has already been completed.",
      "CRM_ACTIVITY_COMPLETED",
    );
  }

  const result = await client.query(
    `UPDATE tenant.crm_activities
        SET status = 'completed', completed_at = now(),
            outcome = COALESCE($1, outcome), updated_by = $2, updated_at = now()
      WHERE organization_id = $3 AND id = $4 AND status <> 'completed'
      RETURNING *`,
    [outcome, context.userId, context.organizationId, activityId],
  );
  if (!result.rows[0]) {
    throw new CrmError(
      409,
      "This activity changed. Refresh it and try again.",
      "CRM_ACTIVITY_CONFLICT",
    );
  }
  const activity = camelizeRow(result.rows[0]);
  if (activity.entityType === "lead" && activity.entityId)
    await client.query(
      `UPDATE tenant.crm_leads SET last_contacted_at = now(), first_responded_at = COALESCE(first_responded_at, now()), updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, activity.entityId],
    );
  if (activity.entityType === "opportunity" && activity.entityId)
    await client.query(
      `UPDATE tenant.crm_opportunities SET last_activity_at = now(), updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, activity.entityId],
    );
  await queueOutboxEvent(
    client,
    context,
    "crm.activity.completed",
    "activity",
    activityId,
    activity,
  );
  return activity;
}
