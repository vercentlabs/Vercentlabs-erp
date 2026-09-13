import { pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const authSchema = pgSchema('auth');

export const mfaLoginTokens = authSchema.table('mfa_login_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export type MfaLoginTokenRow = typeof mfaLoginTokens.$inferSelect;
