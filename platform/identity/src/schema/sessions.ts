import { pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const authSchema = pgSchema('auth');

export const sessions = authSchema.table('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  securityStamp: uuid('security_stamp').notNull(),
  organizationId: uuid('organization_id'),
  assuranceLevel: text('assurance_level').notNull().default('AAL1'),
  authenticatedAt: timestamp('authenticated_at', { withTimezone: true }).notNull(),
  lastStepUpAt: timestamp('last_step_up_at', { withTimezone: true }),
  lastStepUpPurpose: text('last_step_up_purpose'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  inactivityExpiresAt: timestamp('inactivity_expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revocationReason: text('revocation_reason'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  deviceLabel: text('device_label'),
});
export type SessionRow = typeof sessions.$inferSelect;

export const verificationTokens = authSchema.table('verification_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  emailAddressId: uuid('email_address_id').notNull(),
  purpose: text('purpose').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export type VerificationTokenRow = typeof verificationTokens.$inferSelect;

export const passwordResetTokens = authSchema.table('password_reset_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export type PasswordResetTokenRow = typeof passwordResetTokens.$inferSelect;

export const webauthnChallenges = authSchema.table('webauthn_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  sessionId: uuid('session_id'),
  purpose: text('purpose').notNull(),
  challenge: text('challenge').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export type WebAuthnChallengeRow = typeof webauthnChallenges.$inferSelect;

export const stepUpTokens = authSchema.table('step_up_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull(),
  userId: uuid('user_id').notNull(),
  purpose: text('purpose').notNull(),
  method: text('method').notNull(),
  assuranceLevel: text('assurance_level').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});
export type StepUpTokenRow = typeof stepUpTokens.$inferSelect;
