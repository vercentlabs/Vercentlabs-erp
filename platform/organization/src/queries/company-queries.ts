import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  DomainForbiddenError,
  DomainNotFoundError,
  isOrganizationScope,
  type CompanyDto,
  type CompanyStatus,
  type CursorPageResult,
  type TrustedScope,
} from '@vercentlabs/contracts';
import { withOrganizationScope } from '@vercentlabs/database';
import { toCompanyDto } from '../mappers.js';
import { findCompanyById, listCompaniesPage } from '../repository.js';

export interface GetCompanyInput {
  scope: TrustedScope;
  organizationId: string;
  companyId: string;
}

export async function getCompany(db: NodePgDatabase, input: GetCompanyInput): Promise<CompanyDto> {
  if (!isOrganizationScope(input.scope) || input.scope.organizationId !== input.organizationId) {
    throw new DomainForbiddenError('This trusted scope is not authorized for this organization.');
  }

  return withOrganizationScope(db, input.organizationId, async (tx) => {
    const row = await findCompanyById(tx, input.companyId);
    if (!row || row.organizationId !== input.organizationId) {
      throw new DomainNotFoundError('Company', input.companyId);
    }
    return toCompanyDto(row);
  });
}

export interface ListCompaniesInput {
  scope: TrustedScope;
  organizationId: string;
  cursor?: string | undefined;
  limit: number;
  status?: CompanyStatus | undefined;
  search?: string | undefined;
}

export async function listCompanies(
  db: NodePgDatabase,
  input: ListCompaniesInput,
): Promise<CursorPageResult<CompanyDto>> {
  if (!isOrganizationScope(input.scope) || input.scope.organizationId !== input.organizationId) {
    throw new DomainForbiddenError('This trusted scope is not authorized for this organization.');
  }

  return withOrganizationScope(db, input.organizationId, async (tx) => {
    const page = await listCompaniesPage(tx, {
      organizationId: input.organizationId,
      cursor: input.cursor,
      limit: input.limit,
      status: input.status,
      search: input.search,
    });
    return { items: page.items.map(toCompanyDto), nextCursor: page.nextCursor };
  });
}
