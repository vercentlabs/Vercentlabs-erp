import { and, desc, eq, ilike, lt, or } from 'drizzle-orm';
import {
  DomainNotFoundError,
  StaleVersionConflictError,
  decodeCursor,
  encodeCursor,
  type CursorPageResult,
  type OrganizationStatus,
} from '@vercentlabs/contracts';
import { organizations, type OrganizationRow } from './schema.js';
import type { QueryExecutor, TransactionClient } from './tx.js';

export async function findOrganizationByTenantKey(
  db: QueryExecutor,
  tenantKey: string,
): Promise<OrganizationRow | undefined> {
  const [row] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.tenantKey, tenantKey))
    .limit(1);
  return row;
}

export async function findOrganizationById(
  db: QueryExecutor,
  id: string,
): Promise<OrganizationRow | undefined> {
  const [row] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  return row;
}

export interface InsertOrganizationInput {
  tenantKey: string;
  displayName: string;
  legalMetadata?: Record<string, unknown> | null;
  createdBy: string;
  updatedBy: string;
}

export async function insertOrganization(
  tx: TransactionClient,
  input: InsertOrganizationInput,
): Promise<OrganizationRow> {
  const [row] = await tx
    .insert(organizations)
    .values({
      tenantKey: input.tenantKey,
      displayName: input.displayName,
      legalMetadata: input.legalMetadata ?? null,
      status: 'DRAFT',
      version: 1,
      createdBy: input.createdBy,
      updatedBy: input.updatedBy,
    })
    .returning();
  if (!row) throw new Error('insertOrganization: insert returned no row');
  return row;
}

export interface UpdateOrganizationPatch {
  displayName?: string;
  legalMetadata?: Record<string, unknown> | null;
  status?: OrganizationStatus;
  statusReason?: string | null;
  activatedAt?: Date | null;
  suspendedAt?: Date | null;
  recoveredAt?: Date | null;
  closedAt?: Date | null;
  updatedBy: string;
}

/** Conditional UPDATE keyed on id+version; distinguishes not-found from stale-version after the fact, without a race. */
export async function updateOrganizationWithExpectedVersion(
  tx: TransactionClient,
  id: string,
  expectedVersion: number,
  patch: UpdateOrganizationPatch,
): Promise<OrganizationRow> {
  const [updated] = await tx
    .update(organizations)
    .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(eq(organizations.id, id), eq(organizations.version, expectedVersion)))
    .returning();

  if (updated) return updated;

  const current = await findOrganizationById(tx, id);
  if (!current) throw new DomainNotFoundError('Organization', id);
  throw new StaleVersionConflictError(expectedVersion, current.version);
}

export interface ListOrganizationsPageInput {
  cursor?: string | undefined;
  limit: number;
  status?: OrganizationStatus | undefined;
  search?: string | undefined;
}

function escapeLikeTerm(term: string): string {
  return term.replace(/[%_\\]/g, (char) => `\\${char}`);
}

export async function listOrganizationsPage(
  db: QueryExecutor,
  input: ListOrganizationsPageInput,
): Promise<CursorPageResult<OrganizationRow>> {
  const conditions = [];
  if (input.status) {
    conditions.push(eq(organizations.status, input.status));
  }
  if (input.search) {
    const term = `%${escapeLikeTerm(input.search)}%`;
    conditions.push(
      or(ilike(organizations.tenantKey, term), ilike(organizations.displayName, term)),
    );
  }
  if (input.cursor) {
    const decoded = decodeCursor(input.cursor);
    if (decoded) {
      const cursorCreatedAt = new Date(decoded.createdAt);
      conditions.push(
        or(
          lt(organizations.createdAt, cursorCreatedAt),
          and(eq(organizations.createdAt, cursorCreatedAt), lt(organizations.id, decoded.id)),
        ),
      );
    }
  }

  const rows = await db
    .select()
    .from(organizations)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(organizations.createdAt), desc(organizations.id))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const items = hasMore ? rows.slice(0, input.limit) : rows;
  const last = items.at(-1);
  const nextCursor =
    hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

  return { items, nextCursor };
}
