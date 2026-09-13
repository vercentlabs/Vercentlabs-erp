import { and, desc, eq, ilike, lt, or } from 'drizzle-orm';
import {
  DomainNotFoundError,
  StaleVersionConflictError,
  decodeCursor,
  encodeCursor,
  type CompanyStatus,
  type CursorPageResult,
  type OperatingUnitStatus,
} from '@vercentlabs/contracts';
import { companies, operatingUnits, type CompanyRow, type OperatingUnitRow } from './schema.js';
import type { QueryExecutor, TransactionClient } from './tx.js';

function escapeLikeTerm(term: string): string {
  return term.replace(/[%_\\]/g, (char) => `\\${char}`);
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

export async function findCompanyById(
  db: QueryExecutor,
  id: string,
): Promise<CompanyRow | undefined> {
  const [row] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  return row;
}

export async function findCompanyByCode(
  db: QueryExecutor,
  organizationId: string,
  companyCode: string,
): Promise<CompanyRow | undefined> {
  const [row] = await db
    .select()
    .from(companies)
    .where(
      and(eq(companies.organizationId, organizationId), eq(companies.companyCode, companyCode)),
    )
    .limit(1);
  return row;
}

export interface InsertCompanyInput {
  organizationId: string;
  companyCode: string;
  legalName: string;
  displayName: string;
  countryCode: string;
  baseCurrency: string;
  timeZone: string;
  taxRegistrations: unknown[];
  createdBy: string;
  updatedBy: string;
}

export async function insertCompany(
  tx: TransactionClient,
  input: InsertCompanyInput,
): Promise<CompanyRow> {
  const [row] = await tx
    .insert(companies)
    .values({
      organizationId: input.organizationId,
      companyCode: input.companyCode,
      legalName: input.legalName,
      displayName: input.displayName,
      countryCode: input.countryCode,
      baseCurrency: input.baseCurrency,
      timeZone: input.timeZone,
      taxRegistrations: input.taxRegistrations,
      status: 'DRAFT',
      version: 1,
      createdBy: input.createdBy,
      updatedBy: input.updatedBy,
    })
    .returning();
  if (!row) throw new Error('insertCompany: insert returned no row');
  return row;
}

export interface UpdateCompanyPatch {
  legalName?: string;
  displayName?: string;
  timeZone?: string;
  taxRegistrations?: unknown[];
  status?: CompanyStatus;
  statusReason?: string | null;
  updatedBy: string;
}

export async function updateCompanyWithExpectedVersion(
  tx: TransactionClient,
  id: string,
  expectedVersion: number,
  patch: UpdateCompanyPatch,
): Promise<CompanyRow> {
  const [updated] = await tx
    .update(companies)
    .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(eq(companies.id, id), eq(companies.version, expectedVersion)))
    .returning();

  if (updated) return updated;

  const current = await findCompanyById(tx, id);
  if (!current) throw new DomainNotFoundError('Company', id);
  throw new StaleVersionConflictError(expectedVersion, current.version);
}

export interface ListCompaniesPageInput {
  organizationId: string;
  cursor?: string | undefined;
  limit: number;
  status?: CompanyStatus | undefined;
  search?: string | undefined;
}

export async function listCompaniesPage(
  db: QueryExecutor,
  input: ListCompaniesPageInput,
): Promise<CursorPageResult<CompanyRow>> {
  const conditions = [eq(companies.organizationId, input.organizationId)];
  if (input.status) conditions.push(eq(companies.status, input.status));
  if (input.search) {
    const term = `%${escapeLikeTerm(input.search)}%`;
    const searchCondition = or(
      ilike(companies.companyCode, term),
      ilike(companies.displayName, term),
    );
    if (searchCondition) conditions.push(searchCondition);
  }
  if (input.cursor) {
    const decoded = decodeCursor(input.cursor);
    if (decoded) {
      const cursorCreatedAt = new Date(decoded.createdAt);
      conditions.push(
        or(
          lt(companies.createdAt, cursorCreatedAt),
          and(eq(companies.createdAt, cursorCreatedAt), lt(companies.id, decoded.id)),
        )!,
      );
    }
  }

  const rows = await db
    .select()
    .from(companies)
    .where(and(...conditions))
    .orderBy(desc(companies.createdAt), desc(companies.id))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const items = hasMore ? rows.slice(0, input.limit) : rows;
  const last = items.at(-1);
  const nextCursor =
    hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
  return { items, nextCursor };
}

// ---------------------------------------------------------------------------
// Operating units
// ---------------------------------------------------------------------------

export async function findOperatingUnitById(
  db: QueryExecutor,
  id: string,
): Promise<OperatingUnitRow | undefined> {
  const [row] = await db.select().from(operatingUnits).where(eq(operatingUnits.id, id)).limit(1);
  return row;
}

export async function findOperatingUnitByCode(
  db: QueryExecutor,
  companyId: string,
  unitCode: string,
): Promise<OperatingUnitRow | undefined> {
  const [row] = await db
    .select()
    .from(operatingUnits)
    .where(and(eq(operatingUnits.companyId, companyId), eq(operatingUnits.unitCode, unitCode)))
    .limit(1);
  return row;
}

export interface InsertOperatingUnitInput {
  organizationId: string;
  companyId: string;
  unitCode: string;
  name: string;
  unitType: string;
  parentOperatingUnitId: string | null;
  timeZone: string;
  address: unknown | null;
  createdBy: string;
  updatedBy: string;
}

export async function insertOperatingUnit(
  tx: TransactionClient,
  input: InsertOperatingUnitInput,
): Promise<OperatingUnitRow> {
  const [row] = await tx
    .insert(operatingUnits)
    .values({
      organizationId: input.organizationId,
      companyId: input.companyId,
      unitCode: input.unitCode,
      name: input.name,
      unitType: input.unitType,
      parentOperatingUnitId: input.parentOperatingUnitId,
      timeZone: input.timeZone,
      address: input.address,
      status: 'DRAFT',
      version: 1,
      createdBy: input.createdBy,
      updatedBy: input.updatedBy,
    })
    .returning();
  if (!row) throw new Error('insertOperatingUnit: insert returned no row');
  return row;
}

export interface UpdateOperatingUnitPatch {
  name?: string;
  timeZone?: string;
  address?: unknown | null;
  status?: OperatingUnitStatus;
  statusReason?: string | null;
  updatedBy: string;
}

export async function updateOperatingUnitWithExpectedVersion(
  tx: TransactionClient,
  id: string,
  expectedVersion: number,
  patch: UpdateOperatingUnitPatch,
): Promise<OperatingUnitRow> {
  const [updated] = await tx
    .update(operatingUnits)
    .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(eq(operatingUnits.id, id), eq(operatingUnits.version, expectedVersion)))
    .returning();

  if (updated) return updated;

  const current = await findOperatingUnitById(tx, id);
  if (!current) throw new DomainNotFoundError('OperatingUnit', id);
  throw new StaleVersionConflictError(expectedVersion, current.version);
}

export interface ListOperatingUnitsPageInput {
  organizationId: string;
  companyId?: string | undefined;
  cursor?: string | undefined;
  limit: number;
  status?: OperatingUnitStatus | undefined;
  search?: string | undefined;
}

export async function listOperatingUnitsPage(
  db: QueryExecutor,
  input: ListOperatingUnitsPageInput,
): Promise<CursorPageResult<OperatingUnitRow>> {
  const conditions = [eq(operatingUnits.organizationId, input.organizationId)];
  if (input.companyId) conditions.push(eq(operatingUnits.companyId, input.companyId));
  if (input.status) conditions.push(eq(operatingUnits.status, input.status));
  if (input.search) {
    const term = `%${escapeLikeTerm(input.search)}%`;
    const searchCondition = or(
      ilike(operatingUnits.unitCode, term),
      ilike(operatingUnits.name, term),
    );
    if (searchCondition) conditions.push(searchCondition);
  }
  if (input.cursor) {
    const decoded = decodeCursor(input.cursor);
    if (decoded) {
      const cursorCreatedAt = new Date(decoded.createdAt);
      conditions.push(
        or(
          lt(operatingUnits.createdAt, cursorCreatedAt),
          and(eq(operatingUnits.createdAt, cursorCreatedAt), lt(operatingUnits.id, decoded.id)),
        )!,
      );
    }
  }

  const rows = await db
    .select()
    .from(operatingUnits)
    .where(and(...conditions))
    .orderBy(desc(operatingUnits.createdAt), desc(operatingUnits.id))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const items = hasMore ? rows.slice(0, input.limit) : rows;
  const last = items.at(-1);
  const nextCursor =
    hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
  return { items, nextCursor };
}

export async function listChildOperatingUnits(
  db: QueryExecutor,
  parentOperatingUnitId: string,
): Promise<OperatingUnitRow[]> {
  return db
    .select()
    .from(operatingUnits)
    .where(eq(operatingUnits.parentOperatingUnitId, parentOperatingUnitId));
}
