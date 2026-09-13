import { integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const platformSchema = pgSchema('platform');

export const organizations = platformSchema.table('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantKey: text('tenant_key').notNull(),
  displayName: text('display_name').notNull(),
  legalMetadata: jsonb('legal_metadata'),
  status: text('status').notNull().default('DRAFT'),
  statusReason: text('status_reason'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  recoveredAt: timestamp('recovered_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdBy: text('created_by').notNull(),
  updatedBy: text('updated_by').notNull(),
});

export type OrganizationRow = typeof organizations.$inferSelect;
