import { and, eq, isNull } from 'drizzle-orm';
import {
  passwordCredentials,
  recoveryCodes,
  totpCredentials,
  webauthnCredentials,
  type PasswordCredentialRow,
  type RecoveryCodeRow,
  type TotpCredentialRow,
  type WebAuthnCredentialRow,
} from '../schema/credentials.js';
import type { QueryExecutor, TransactionClient } from '../tx.js';

// ---------------------------------------------------------------------
// Password credentials
// ---------------------------------------------------------------------

export async function findPasswordCredential(
  db: QueryExecutor,
  userId: string,
): Promise<PasswordCredentialRow | undefined> {
  const [row] = await db
    .select()
    .from(passwordCredentials)
    .where(eq(passwordCredentials.userId, userId))
    .limit(1);
  return row;
}

export async function insertPasswordCredential(
  tx: TransactionClient,
  input: { userId: string; passwordHash: string },
): Promise<PasswordCredentialRow> {
  const [row] = await tx
    .insert(passwordCredentials)
    .values({ userId: input.userId, passwordHash: input.passwordHash })
    .returning();
  if (!row) throw new Error('insertPasswordCredential: INSERT ... RETURNING produced no row.');
  return row;
}

export async function updatePasswordHash(
  tx: TransactionClient,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await tx
    .update(passwordCredentials)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(passwordCredentials.userId, userId));
}

// ---------------------------------------------------------------------
// TOTP credentials
// ---------------------------------------------------------------------

export async function findTotpCredential(
  db: QueryExecutor,
  userId: string,
): Promise<TotpCredentialRow | undefined> {
  const [row] = await db
    .select()
    .from(totpCredentials)
    .where(and(eq(totpCredentials.userId, userId), isNull(totpCredentials.revokedAt)))
    .limit(1);
  return row;
}

export async function insertTotpCredential(
  tx: TransactionClient,
  input: {
    userId: string;
    secretCiphertext: Buffer;
    secretIv: Buffer;
    secretAuthTag: Buffer;
    keyVersion: number;
  },
): Promise<TotpCredentialRow> {
  const [row] = await tx
    .insert(totpCredentials)
    .values({
      userId: input.userId,
      secretCiphertext: input.secretCiphertext,
      secretIv: input.secretIv,
      secretAuthTag: input.secretAuthTag,
      keyVersion: input.keyVersion,
    })
    .returning();
  if (!row) throw new Error('insertTotpCredential: INSERT ... RETURNING produced no row.');
  return row;
}

export async function confirmTotpCredential(tx: TransactionClient, id: string): Promise<void> {
  await tx
    .update(totpCredentials)
    .set({ confirmedAt: new Date(), updatedAt: new Date() })
    .where(eq(totpCredentials.id, id));
}

export async function recordTotpStepUsed(
  tx: TransactionClient,
  id: string,
  step: number,
): Promise<void> {
  await tx
    .update(totpCredentials)
    .set({ lastUsedStep: step, updatedAt: new Date() })
    .where(eq(totpCredentials.id, id));
}

export async function revokeTotpCredential(tx: TransactionClient, id: string): Promise<void> {
  await tx
    .update(totpCredentials)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(totpCredentials.id, id));
}

// ---------------------------------------------------------------------
// WebAuthn credentials
// ---------------------------------------------------------------------

export async function listWebAuthnCredentials(
  db: QueryExecutor,
  userId: string,
): Promise<WebAuthnCredentialRow[]> {
  return db
    .select()
    .from(webauthnCredentials)
    .where(and(eq(webauthnCredentials.userId, userId), isNull(webauthnCredentials.revokedAt)));
}

export async function findWebAuthnCredentialById(
  db: QueryExecutor,
  id: string,
): Promise<WebAuthnCredentialRow | undefined> {
  const [row] = await db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.id, id))
    .limit(1);
  return row;
}

export async function findWebAuthnCredentialByCredentialId(
  db: QueryExecutor,
  credentialId: string,
): Promise<WebAuthnCredentialRow | undefined> {
  const [row] = await db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.credentialId, credentialId))
    .limit(1);
  return row;
}

export async function insertWebAuthnCredential(
  tx: TransactionClient,
  input: {
    userId: string;
    credentialId: string;
    publicKey: Buffer;
    counter: number;
    deviceType?: string | null;
    backedUp: boolean;
    transports?: string[] | null;
    name: string;
  },
): Promise<WebAuthnCredentialRow> {
  const [row] = await tx
    .insert(webauthnCredentials)
    .values({
      userId: input.userId,
      credentialId: input.credentialId,
      publicKey: input.publicKey,
      counter: input.counter,
      deviceType: input.deviceType ?? null,
      backedUp: input.backedUp,
      transports: input.transports ?? null,
      name: input.name,
    })
    .returning();
  if (!row) throw new Error('insertWebAuthnCredential: INSERT ... RETURNING produced no row.');
  return row;
}

export async function updateWebAuthnCounter(
  tx: TransactionClient,
  id: string,
  counter: number,
): Promise<void> {
  await tx
    .update(webauthnCredentials)
    .set({ counter, lastUsedAt: new Date() })
    .where(eq(webauthnCredentials.id, id));
}

export async function renameWebAuthnCredential(
  tx: TransactionClient,
  id: string,
  name: string,
): Promise<void> {
  await tx.update(webauthnCredentials).set({ name }).where(eq(webauthnCredentials.id, id));
}

export async function revokeWebAuthnCredential(tx: TransactionClient, id: string): Promise<void> {
  await tx
    .update(webauthnCredentials)
    .set({ revokedAt: new Date() })
    .where(eq(webauthnCredentials.id, id));
}

// ---------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------

export async function insertRecoveryCodes(
  tx: TransactionClient,
  input: { userId: string; generationBatchId: string; codeHashes: string[] },
): Promise<void> {
  if (input.codeHashes.length === 0) return;
  await tx.insert(recoveryCodes).values(
    input.codeHashes.map((codeHash) => ({
      userId: input.userId,
      codeHash,
      generationBatchId: input.generationBatchId,
    })),
  );
}

export async function findRecoveryCodeByHash(
  db: QueryExecutor,
  codeHash: string,
): Promise<RecoveryCodeRow | undefined> {
  const [row] = await db
    .select()
    .from(recoveryCodes)
    .where(eq(recoveryCodes.codeHash, codeHash))
    .limit(1);
  return row;
}

/** Atomic, concurrency-safe single-use consumption: two simultaneous uses of the same code can never both succeed. */
export async function consumeRecoveryCode(
  tx: TransactionClient,
  id: string,
): Promise<RecoveryCodeRow | undefined> {
  const [row] = await tx
    .update(recoveryCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(recoveryCodes.id, id), isNull(recoveryCodes.usedAt)))
    .returning();
  return row;
}

export async function countUnusedRecoveryCodes(db: QueryExecutor, userId: string): Promise<number> {
  const rows = await db
    .select({ id: recoveryCodes.id })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
  return rows.length;
}
