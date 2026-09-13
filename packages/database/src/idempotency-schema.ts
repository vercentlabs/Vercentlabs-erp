import { integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const platformSchema = pgSchema('platform');

export const idempotencyRecords = platformSchema.table('idempotency_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id'),
  actorId: text('actor_id').notNull(),
  operationName: text('operation_name').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  processingState: text('processing_state').notNull().default('IN_PROGRESS'),
  responseStatus: integer('response_status'),
  responseBody: jsonb('response_body'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
