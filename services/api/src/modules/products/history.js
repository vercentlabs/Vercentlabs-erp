// The product audit trail: one row per significant master-data change, with
// the old and new values.
export async function recordProductHistory(client, context, itemId, eventType, summary, changes = {}) {
  await client.query(
    // clock_timestamp: several events in one transaction keep their order.
    `INSERT INTO tenant.product_history (organization_id, item_id, event_type, summary, changes, actor_user_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp())`,
    [context.organizationId, itemId, eventType, String(summary).slice(0, 500), JSON.stringify(changes), context.userId ?? null],
  );
}

export async function listProductHistory(client, context, itemId) {
  const { rows } = await client.query(
    `SELECT history.id, history.event_type, history.summary, history.changes, history.created_at, actor.full_name AS actor_name
       FROM tenant.product_history history LEFT JOIN public.users actor ON actor.id = history.actor_user_id
      WHERE history.organization_id = $1 AND history.item_id = $2
      ORDER BY history.created_at DESC, history.id DESC LIMIT 300`,
    [context.organizationId, itemId],
  );
  return rows.map((row) => ({ id: row.id, eventType: row.event_type, summary: row.summary, changes: row.changes, createdAt: row.created_at, actorName: row.actor_name }));
}
