import {
  bigint,
  boolean,
  customType,
  integer,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const authSchema = pgSchema('auth');

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const passwordCredentials = authSchema.table('password_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});
export type PasswordCredentialRow = typeof passwordCredentials.$inferSelect;

export const webauthnCredentials = authSchema.table('webauthn_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  credentialId: text('credential_id').notNull(),
  publicKey: bytea('public_key').notNull(),
  counter: bigint('counter', { mode: 'number' }).notNull().default(0),
  deviceType: text('device_type'),
  backedUp: boolean('backed_up').notNull().default(false),
  transports: text('transports').array(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});
export type WebAuthnCredentialRow = typeof webauthnCredentials.$inferSelect;

export const totpCredentials = authSchema.table('totp_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  secretCiphertext: bytea('secret_ciphertext').notNull(),
  secretIv: bytea('secret_iv').notNull(),
  secretAuthTag: bytea('secret_auth_tag').notNull(),
  keyVersion: integer('key_version').notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  lastUsedStep: bigint('last_used_step', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});
export type TotpCredentialRow = typeof totpCredentials.$inferSelect;

export const recoveryCodes = authSchema.table('recovery_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  codeHash: text('code_hash').notNull(),
  generationBatchId: uuid('generation_batch_id').notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export type RecoveryCodeRow = typeof recoveryCodes.$inferSelect;
