// The Shared Platform transactional outbox. publishDomainEvent() is called
// inside the SAME transaction as the business write, so an event exists if
// and only if the change committed. Each event has a stable id. The worker
// fans committed events out (webhook deliveries, workflow runs) at least
// once; every consumer is idempotent on that id.
export async function publishDomainEvent(client, { organizationId, moduleKey, eventType, entityType, entityId, payload = {} }) {
  if (!organizationId) throw new Error("publishDomainEvent requires an organization.");
  const type = String(eventType || "").trim();
  if (!/^[a-z0-9_-]+(\.[a-z0-9_-]+){1,5}$/.test(type)) throw new Error(`Invalid domain event type "${type}".`);
  // Parameter order: organization, type, entity type, entity id, payload, module.
  const { rows } = await client.query(
    `INSERT INTO tenant.platform_events (organization_id, event_type, entity_type, entity_id, payload, module_key)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING id`,
    [organizationId, type, String(entityType || ""), String(entityId ?? ""), payload ?? {}, String(moduleKey || type.split(".")[0])],
  );
  return rows[0]?.id ?? null;
}

/**
 * Claims committed events for fan-out (FOR UPDATE SKIP LOCKED), hands each to
 * every fan-out handler in the same transaction, then marks it dispatched.
 * Handlers are idempotent on the event id (unique constraints), so a crash
 * between fan-out and commit simply repeats the work.
 */
export async function dispatchPendingEvents(client, organizationId, { fanOut = [], limit = 50 } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM tenant.platform_events
      WHERE organization_id=$1 AND dispatch_status='pending'
      ORDER BY occurred_at, id LIMIT $2 FOR UPDATE SKIP LOCKED`,
    [organizationId, limit],
  );
  for (const event of rows) {
    for (const handler of fanOut) await handler(client, event);
    await client.query(`UPDATE tenant.platform_events SET dispatch_status='dispatched', dispatched_at=now() WHERE id=$1`, [event.id]);
  }
  return { dispatched: rows.length };
}
