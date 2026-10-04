// The opportunity audit trail: one append-only row per important change
// (created, owner, stage, value, close date, quotation, won, lost, reopened).
// The application role can only INSERT and SELECT this table.
export async function recordOpportunityHistory(client, context, opportunityId, eventType, summary, changes = {}) {
  await client.query(
    `INSERT INTO tenant.crm_opportunity_history (organization_id, opportunity_id, event_type, summary, changes, actor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [context.organizationId, opportunityId, eventType, String(summary).slice(0, 500), JSON.stringify(changes), context.userId ?? null],
  );
}

// Callers load the opportunity first (getOpportunity), which is what enforces visibility.
export async function listOpportunityHistoryEntries(client, context, opportunityId, { limit = 200, eventTypes = null } = {}) {
  const { rows } = await client.query(
    `SELECT history.id, history.event_type, history.summary, history.changes, history.created_at, history.actor_user_id, actor.full_name AS actor_name
       FROM tenant.crm_opportunity_history history
       LEFT JOIN public.users actor ON actor.id = history.actor_user_id
      WHERE history.organization_id = $1 AND history.opportunity_id = $2 AND ($3::text[] IS NULL OR history.event_type = ANY ($3))
      ORDER BY history.created_at DESC, history.id DESC
      LIMIT $4`,
    [context.organizationId, opportunityId, eventTypes, Math.min(Math.max(Number(limit) || 200, 1), 500)],
  );
  return rows.map((row) => ({
    id: row.id, eventType: row.event_type, summary: row.summary, changes: row.changes, createdAt: row.created_at,
    actorUserId: row.actor_user_id, actorName: row.actor_name ?? null,
  }));
}
