// The contact timeline and audit trail: one append-only row per significant
// event, with old and new values for field changes.
import { requireUuid } from "./validation.js";

export async function recordContactHistory(client, context, contactId, eventType, summary, changes = {}) {
  await client.query(
    // clock_timestamp, not now(): events recorded in one transaction keep their order.
    `INSERT INTO tenant.crm_contact_history (organization_id, contact_id, event_type, summary, changes, actor_user_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp())`,
    [context.organizationId, contactId, eventType, String(summary).slice(0, 500), JSON.stringify(changes), context.userId ?? null],
  );
}

// Callers load the contact first (getContact), which enforces visibility.
export async function listContactHistory(client, context, contactId, { limit = 200 } = {}) {
  const { rows } = await client.query(
    `SELECT history.id, history.event_type, history.summary, history.changes, history.created_at, actor.full_name AS actor_name
       FROM tenant.crm_contact_history history
       LEFT JOIN public.users actor ON actor.id = history.actor_user_id
      WHERE history.organization_id = $1 AND history.contact_id = $2
      ORDER BY history.created_at DESC, history.id DESC
      LIMIT $3`,
    [context.organizationId, requireUuid(contactId, "Contact"), Math.min(Math.max(Number(limit) || 200, 1), 500)],
  );
  return rows.map((row) => ({
    id: row.id, eventType: row.event_type, summary: row.summary, changes: row.changes, createdAt: row.created_at, actorName: row.actor_name,
  }));
}
