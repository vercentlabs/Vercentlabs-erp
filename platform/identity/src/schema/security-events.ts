import { bigserial, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';

const authSchema = pgSchema('auth');

export const authenticationAttempts = authSchema.table('authentication_attempts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  identityKey: text('identity_key').notNull(),
  ipAddress: text('ip_address'),
  outcome: text('outcome').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});
export type AuthenticationAttemptRow = typeof authenticationAttempts.$inferSelect;
