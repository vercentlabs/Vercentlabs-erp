// Shared POS audit-trail writer. Every capability records its own domain
// events (sale completed, return approved, shift closed, ...) through this
// one function so tenant.pos_events stays the single authoritative POS
// audit stream, never a per-capability parallel log.
export async function event(client, context, aggregateType, aggregateId, eventType, payload = {}) {
  await client.query(
    `INSERT INTO tenant.pos_events
      (organization_id,company_id,aggregate_type,aggregate_id,event_type,payload,actor_user_id)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [context.organizationId, context.companyId, aggregateType, aggregateId, eventType, JSON.stringify(payload), context.userId || null],
  );
}
