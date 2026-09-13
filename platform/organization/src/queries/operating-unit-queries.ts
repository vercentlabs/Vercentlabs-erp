import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  DomainForbiddenError,
  DomainNotFoundError,
  isOrganizationScope,
  type CursorPageResult,
  type OperatingUnitDto,
  type OperatingUnitStatus,
  type TrustedScope,
} from '@vercentlabs/contracts';
import { withOrganizationScope } from '@vercentlabs/database';
import { toOperatingUnitDto } from '../mappers.js';
import {
  findOperatingUnitById,
  listChildOperatingUnits,
  listOperatingUnitsPage,
} from '../repository.js';

function assertScope(
  scope: TrustedScope,
  organizationId: string,
): asserts scope is TrustedScope & { organizationId: string } {
  if (!isOrganizationScope(scope) || scope.organizationId !== organizationId) {
    throw new DomainForbiddenError('This trusted scope is not authorized for this organization.');
  }
}

export interface GetOperatingUnitInput {
  scope: TrustedScope;
  organizationId: string;
  operatingUnitId: string;
}

export async function getOperatingUnit(
  db: NodePgDatabase,
  input: GetOperatingUnitInput,
): Promise<OperatingUnitDto> {
  assertScope(input.scope, input.organizationId);

  return withOrganizationScope(db, input.organizationId, async (tx) => {
    const row = await findOperatingUnitById(tx, input.operatingUnitId);
    if (!row || row.organizationId !== input.organizationId) {
      throw new DomainNotFoundError('OperatingUnit', input.operatingUnitId);
    }
    return toOperatingUnitDto(row);
  });
}

export interface ListOperatingUnitsInput {
  scope: TrustedScope;
  organizationId: string;
  companyId?: string | undefined;
  cursor?: string | undefined;
  limit: number;
  status?: OperatingUnitStatus | undefined;
  search?: string | undefined;
}

export async function listOperatingUnits(
  db: NodePgDatabase,
  input: ListOperatingUnitsInput,
): Promise<CursorPageResult<OperatingUnitDto>> {
  assertScope(input.scope, input.organizationId);

  return withOrganizationScope(db, input.organizationId, async (tx) => {
    const page = await listOperatingUnitsPage(tx, {
      organizationId: input.organizationId,
      companyId: input.companyId,
      cursor: input.cursor,
      limit: input.limit,
      status: input.status,
      search: input.search,
    });
    return { items: page.items.map(toOperatingUnitDto), nextCursor: page.nextCursor };
  });
}

export interface ResolveOperatingUnitChildrenInput {
  scope: TrustedScope;
  organizationId: string;
  operatingUnitId: string;
}

/** Resolves the direct children of an operating unit - the explicit, testable half of "scope inheritance must be explicit". */
export async function resolveOperatingUnitChildren(
  db: NodePgDatabase,
  input: ResolveOperatingUnitChildrenInput,
): Promise<OperatingUnitDto[]> {
  assertScope(input.scope, input.organizationId);

  return withOrganizationScope(db, input.organizationId, async (tx) => {
    const parent = await findOperatingUnitById(tx, input.operatingUnitId);
    if (!parent || parent.organizationId !== input.organizationId) {
      throw new DomainNotFoundError('OperatingUnit', input.operatingUnitId);
    }
    const children = await listChildOperatingUnits(tx, input.operatingUnitId);
    return children.map(toOperatingUnitDto);
  });
}
