// The follow-up's history: one row per meaningful change, never edited or removed.
// "Oct 4 scheduled for Oct 6 → Oct 6 rescheduled to Oct 8 → Oct 8 completed."

export async function recordFollowUpHistory(client, context, followUpId, eventType, summary, changes = {}) {
  await client.query(
    `INSERT INTO tenant.crm_follow_up_history (organization_id, follow_up_id, event_type, summary, changes, actor_user_id) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [context.organizationId, followUpId, eventType, String(summary).slice(0, 500), JSON.stringify(changes ?? {}), context.userId ?? null],
  );
}

export async function listFollowUpHistoryEntries(client, context, followUpId) {
  const { rows } = await client.query(
    `SELECT history.id, history.event_type, history.summary, history.changes, history.created_at, actor.full_name AS actor_name
       FROM tenant.crm_follow_up_history history
       LEFT JOIN public.users actor ON actor.id = history.actor_user_id
      WHERE history.organization_id = $1 AND history.follow_up_id = $2
      ORDER BY history.created_at DESC, history.id DESC`,
    [context.organizationId, followUpId],
  );
  return rows.map((row) => ({ id: row.id, eventType: row.event_type, summary: row.summary, changes: row.changes, createdAt: row.created_at, actorName: row.actor_name ?? null }));
}
