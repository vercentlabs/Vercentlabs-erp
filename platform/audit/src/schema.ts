import { jsonb, pgSchema, text, timestamp, uuid, integer } from 'drizzle-orm/pg-core';

const auditSchema = pgSchema('audit');

export const auditEvents = auditSchema.table('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id'),
  companyId: uuid('company_id'),
  operatingUnitId: uuid('operating_unit_id'),
  actorId: text('actor_id').notNull(),
  actorType: text('actor_type').notNull(),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  previousVersion: integer('previous_version'),
  previousState: text('previous_state'),
  newVersion: integer('new_version'),
  newState: text('new_state'),
  reason: text('reason'),
  correlationId: text('correlation_id').notNull(),
  requestId: text('request_id').notNull(),
  changedFields: jsonb('changed_fields'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});
