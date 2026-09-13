import { and, eq } from 'drizzle-orm';
import { StaleVersionConflictError } from '@vercentlabs/contracts';
import {
  organizationMemberships,
  userEmailAddresses,
  userLifecycleHistory,
  users,
  type OrganizationMembershipRow,
  type UserEmailAddressRow,
  type UserRow,
} from '../schema/identity.js';
import type { QueryExecutor, TransactionClient } from '../tx.js';

export async function findUserById(db: QueryExecutor, id: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

export async function findEmailByNormalized(
  db: QueryExecutor,
  emailNormalized: string,
): Promise<UserEmailAddressRow | undefined> {
  const [row] = await db
    .select()
    .from(userEmailAddresses)
    .where(eq(userEmailAddresses.emailNormalized, emailNormalized))
    .limit(1);
  return row;
}

export async function findEmailById(
  db: QueryExecutor,
  id: string,
): Promise<UserEmailAddressRow | undefined> {
  const [row] = await db
    .select()
    .from(userEmailAddresses)
    .where(eq(userEmailAddresses.id, id))
    .limit(1);
  return row;
}

export async function findPrimaryEmailForUser(
  db: QueryExecutor,
  userId: string,
): Promise<UserEmailAddressRow | undefined> {
  const [row] = await db
    .select()
    .from(userEmailAddresses)
    .where(and(eq(userEmailAddresses.userId, userId), eq(userEmailAddresses.isPrimary, true)))
    .limit(1);
  return row;
}

export interface InsertUserInput {
  status: 'INVITED' | 'ACTIVE';
  displayName?: string | null;
  createdBy: string;
  updatedBy: string;
}

export async function insertUser(tx: TransactionClient, input: InsertUserInput): Promise<UserRow> {
  const [row] = await tx
    .insert(users)
    .values({
      status: input.status,
      displayName: input.displayName ?? null,
      createdBy: input.createdBy,
      updatedBy: input.updatedBy,
      activatedAt: input.status === 'ACTIVE' ? new Date() : null,
    })
    .returning();
  if (!row) throw new Error('insertUser: INSERT ... RETURNING produced no row.');
  return row;
}

export async function insertEmailAddress(
  tx: TransactionClient,
  input: {
    userId: string;
    emailNormalized: string;
    emailOriginal: string;
    isPrimary: boolean;
    verifiedAt?: Date | null;
  },
): Promise<UserEmailAddressRow> {
  const [row] = await tx
    .insert(userEmailAddresses)
    .values({
      userId: input.userId,
      emailNormalized: input.emailNormalized,
      emailOriginal: input.emailOriginal,
      isPrimary: input.isPrimary,
      verifiedAt: input.verifiedAt ?? null,
    })
    .returning();
  if (!row) throw new Error('insertEmailAddress: INSERT ... RETURNING produced no row.');
  return row;
}

export async function markEmailVerified(
  tx: TransactionClient,
  emailAddressId: string,
): Promise<void> {
  await tx
    .update(userEmailAddresses)
    .set({ verifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(userEmailAddresses.id, emailAddressId));
}

/** Conditional UPDATE ... WHERE version = $expected, disambiguating not-found vs. stale-version via a follow-up SELECT. */
export async function updateUserWithExpectedVersion(
  tx: TransactionClient,
  id: string,
  expectedVersion: number,
  changes: Partial<
    Pick<
      UserRow,
      | 'status'
      | 'statusReason'
      | 'displayName'
      | 'securityStamp'
      | 'updatedBy'
      | 'activatedAt'
      | 'suspendedAt'
      | 'reactivatedAt'
      | 'deactivatedAt'
    >
  >,
): Promise<UserRow> {
  const [updated] = await tx
    .update(users)
    .set({ ...changes, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(eq(users.id, id), eq(users.version, expectedVersion)))
    .returning();
  if (updated) return updated;

  const current = await findUserById(tx, id);
  if (!current) throw new Error(`User "${id}" was not found.`);
  throw new StaleVersionConflictError(expectedVersion, current.version);
}

export async function recordLifecycleEvent(
  tx: TransactionClient,
  input: {
    userId: string;
    fromStatus: string | null;
    toStatus: string;
    reason?: string | null;
    actorId: string;
  },
): Promise<void> {
  await tx.insert(userLifecycleHistory).values({
    userId: input.userId,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    reason: input.reason ?? null,
    actorId: input.actorId,
  });
}

export async function insertMembership(
  tx: TransactionClient,
  input: { userId: string; organizationId: string; createdBy: string; updatedBy: string },
): Promise<OrganizationMembershipRow> {
  const [row] = await tx
    .insert(organizationMemberships)
    .values({
      userId: input.userId,
      organizationId: input.organizationId,
      createdBy: input.createdBy,
      updatedBy: input.updatedBy,
    })
    .returning();
  if (!row) throw new Error('insertMembership: INSERT ... RETURNING produced no row.');
  return row;
}

export async function listMembershipsForUser(
  db: QueryExecutor,
  userId: string,
): Promise<OrganizationMembershipRow[]> {
  return db
    .select()
    .from(organizationMemberships)
    .where(eq(organizationMemberships.userId, userId));
}

export async function listActiveMembershipOrganizationIds(
  db: QueryExecutor,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ organizationId: organizationMemberships.organizationId })
    .from(organizationMemberships)
    .where(
      and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.status, 'ACTIVE')),
    );
  return rows.map((row) => row.organizationId);
}
