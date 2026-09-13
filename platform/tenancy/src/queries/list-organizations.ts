import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  DomainForbiddenError,
  isPlatformOperatorScope,
  type CursorPageResult,
  type OrganizationDto,
  type OrganizationStatus,
  type TrustedScope,
} from '@vercentlabs/contracts';
import { toOrganizationDto } from '../mappers.js';
import { listOrganizationsPage } from '../repository.js';

export interface ListOrganizationsInput {
  scope: TrustedScope;
  cursor?: string | undefined;
  limit: number;
  status?: OrganizationStatus | undefined;
  search?: string | undefined;
}

export async function listOrganizations(
  db: NodePgDatabase,
  input: ListOrganizationsInput,
): Promise<CursorPageResult<OrganizationDto>> {
  if (!isPlatformOperatorScope(input.scope)) {
    throw new DomainForbiddenError('Only a platform operator may list organizations.');
  }

  const page = await listOrganizationsPage(db, {
    cursor: input.cursor,
    limit: input.limit,
    status: input.status,
    search: input.search,
  });

  return { items: page.items.map(toOrganizationDto), nextCursor: page.nextCursor };
}
