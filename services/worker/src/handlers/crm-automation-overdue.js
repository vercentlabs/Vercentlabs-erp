import { z } from "zod";
import { runCrmAutomation } from "@vercentlabs/api";

export const JOB_TYPE = "crm.automation.detect_overdue_activities";

export const payloadSchema = z.object({}).strict();

// Fires the ALREADY-REAL, already-tested automation engine
// (runCrmAutomation, services/api/src/crm.js) for the "activity.overdue"
// event — one of the 4 event types Prompt 10/11 found never fire. This is
// the one of the four that is genuinely a scheduled/time-based trigger
// (the other three — lead.updated, lead.qualified,
// campaign.member_responded — are missing synchronous call sites in
// mutation code paths, an unrelated, non-scheduling gap this prompt does
// not touch; see ERP_WORKER_SCHEDULER_013.md Section 16).
//
// Idempotency: the WHERE clause on the status-transition UPDATE below is
// the whole idempotency mechanism — it only ever matches an activity
// still in 'planned'/'in_progress'. Once transitioned to 'overdue', the
// exact same query on a later tick can never match that row again, so a
// concurrently-running duplicate tick (or a retried job after a partial
// failure) cannot re-fire the same activity's automation twice. No new
// schema was added for this — it reuses the 'overdue' status value the
// activities table's own CHECK constraint has always allowed
// (002_crm_module.sql) but which nothing previously set.
export async function detectOverdueActivitiesHandler(client, context, _payload) {
  const due = await client.query(
    `SELECT * FROM tenant.crm_activities
      WHERE organization_id = $1
        AND status IN ('planned', 'in_progress')
        AND due_at IS NOT NULL AND due_at < now()
      ORDER BY due_at ASC
      LIMIT 200`,
    [context.organizationId],
  );

  let fired = 0;
  for (const activity of due.rows) {
    const transitioned = await client.query(
      `UPDATE tenant.crm_activities
          SET status = 'overdue', updated_at = now()
        WHERE organization_id = $1 AND id = $2 AND status IN ('planned', 'in_progress')
        RETURNING *`,
      [context.organizationId, activity.id],
    );
    const row = transitioned.rows[0];
    if (!row) continue; // already transitioned by a concurrent tick — skip, do not re-fire

    await runCrmAutomation(client, context, "activity.overdue", "activity", row.id, row);
    fired += 1;
  }

  return { scanned: due.rows.length, fired };
}
