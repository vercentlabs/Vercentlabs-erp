// The lead audit trail: one append-only row per important change (creation,
// owner, stage, status, qualification, conversion, key field edits). The
// application role can only INSERT and SELECT this table.
import { requireUuid } from "./validation.js";

export async function recordLeadHistory(client, context, leadId, eventType, summary, changes = {}) {
  await client.query(
    // clock_timestamp(): several events in one transaction keep their order.
    `INSERT INTO tenant.crm_lead_history (organization_id, lead_id, event_type, summary, changes, actor_user_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp())`,
    [context.organizationId, leadId, eventType, String(summary).slice(0, 500), JSON.stringify(changes), context.userId ?? null],
  );
}

// Callers load the lead first (getLead), which is what enforces visibility.
export async function listLeadHistory(client, context, leadId, { limit = 100, eventTypes = null } = {}) {
  const { rows } = await client.query(
    `SELECT history.id, history.event_type, history.summary, history.changes, history.created_at,
            history.actor_user_id, actor.full_name AS actor_name
       FROM tenant.crm_lead_history history
       LEFT JOIN public.users actor ON actor.id = history.actor_user_id
      WHERE history.organization_id = $1 AND history.lead_id = $2
        AND ($3::text[] IS NULL OR history.event_type = ANY ($3))
      ORDER BY history.created_at DESC, history.id DESC
      LIMIT $4`,
    [context.organizationId, requireUuid(leadId, "Lead"), eventTypes, Math.min(Math.max(Number(limit) || 100, 1), 500)],
  );
  return rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    summary: row.summary,
    changes: row.changes,
    createdAt: row.created_at,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
  }));
}
