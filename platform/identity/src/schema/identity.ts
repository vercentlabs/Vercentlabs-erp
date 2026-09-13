import { boolean, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const identitySchema = pgSchema('identity');

export const users = identitySchema.table('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: text('status').notNull().default('INVITED'),
  statusReason: text('status_reason'),
  displayName: text('display_name'),
  securityStamp: uuid('security_stamp').notNull().defaultRandom(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  invitedAt: timestamp('invited_at', { withTimezone: true }),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  reactivatedAt: timestamp('reactivated_at', { withTimezone: true }),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  createdBy: text('created_by').notNull(),
  updatedBy: text('updated_by').notNull(),
});
export type UserRow = typeof users.$inferSelect;

export const userEmailAddresses = identitySchema.table('user_email_addresses', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  emailNormalized: text('email_normalized').notNull(),
  emailOriginal: text('email_original').notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export type UserEmailAddressRow = typeof userEmailAddresses.$inferSelect;

export const organizationMemberships = identitySchema.table('organization_memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  organizationId: uuid('organization_id').notNull(),
  status: text('status').notNull().default('ACTIVE'),
  version: integer('version').notNull().default(1),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  removedAt: timestamp('removed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by').notNull(),
  updatedBy: text('updated_by').notNull(),
});
export type OrganizationMembershipRow = typeof organizationMemberships.$inferSelect;

export const userInvitations = identitySchema.table('user_invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  emailNormalized: text('email_normalized').notNull(),
  tokenHash: text('token_hash').notNull(),
  status: text('status').notNull().default('PENDING'),
  invitedBy: text('invited_by').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  acceptedUserId: uuid('accepted_user_id'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});
export type UserInvitationRow = typeof userInvitations.$inferSelect;

export const userLifecycleHistory = identitySchema.table('user_lifecycle_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  reason: text('reason'),
  actorId: text('actor_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});
export type UserLifecycleHistoryRow = typeof userLifecycleHistory.$inferSelect;
