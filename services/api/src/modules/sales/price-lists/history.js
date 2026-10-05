// The price list audit trail: list changes and price changes, with old and
// new values, so anyone can see that a product cost 1,000 and now costs 1,100.
export async function recordPriceListHistory(client, context, priceListId, eventType, summary, { entryId = null, itemId = null, changes = {} } = {}) {
  await client.query(
    `INSERT INTO tenant.price_list_history (organization_id, price_list_id, entry_id, item_id, event_type, summary, changes, actor_user_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, clock_timestamp())`,
    [context.organizationId, priceListId, entryId, itemId, eventType, String(summary).slice(0, 500), JSON.stringify(changes), context.userId ?? null],
  );
}

export async function listPriceListHistory(client, context, priceListId, { itemId = null } = {}) {
  const { rows } = await client.query(
    `SELECT history.id, history.event_type, history.summary, history.changes, history.item_id, history.created_at, actor.full_name AS actor_name, item.code AS item_code
       FROM tenant.price_list_history history
       LEFT JOIN public.users actor ON actor.id = history.actor_user_id
       LEFT JOIN tenant.items item ON item.organization_id = history.organization_id AND item.id = history.item_id
      WHERE history.organization_id = $1 AND history.price_list_id = $2 AND ($3::uuid IS NULL OR history.item_id = $3)
      ORDER BY history.created_at DESC, history.id DESC LIMIT 500`,
    [context.organizationId, priceListId, itemId],
  );
  return rows.map((row) => ({
    id: row.id, eventType: row.event_type, summary: row.summary, changes: row.changes, itemId: row.item_id, itemCode: row.item_code, createdAt: row.created_at, actorName: row.actor_name,
  }));
}
