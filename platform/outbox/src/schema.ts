import { integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const integrationSchema = pgSchema('integration');

export const outboxEvents = integrationSchema.table('outbox_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: text('aggregate_id').notNull(),
  organizationId: uuid('organization_id'),
  eventType: text('event_type').notNull(),
  schemaVersion: integer('schema_version').notNull().default(1),
  aggregateVersion: integer('aggregate_version').notNull(),
  payload: jsonb('payload').notNull(),
  correlationId: text('correlation_id').notNull(),
  causationId: text('causation_id'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  deliveryState: text('delivery_state').notNull().default('PENDING'),
});
