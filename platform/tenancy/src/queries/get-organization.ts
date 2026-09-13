import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  DomainForbiddenError,
  DomainNotFoundError,
  isPlatformOperatorScope,
  type OrganizationDto,
  type TrustedScope,
} from '@vercentlabs/contracts';
import { toOrganizationDto } from '../mappers.js';
import { organizations } from '../schema.js';
import { eq } from 'drizzle-orm';

export interface GetOrganizationInput {
  scope: TrustedScope;
  organizationId: string;
}

/**
 * Uses the same authorization check as list/search (see also
 * listOrganizations): every non-platform-operator caller gets the identical
 * FORBIDDEN response regardless of whether `organizationId` is real, so no
 * caller who lacks access ever learns anything about existence.
 */
export async function getOrganization(
  db: NodePgDatabase,
  input: GetOrganizationInput,
): Promise<OrganizationDto> {
  if (!isPlatformOperatorScope(input.scope)) {
    throw new DomainForbiddenError('Only a platform operator may read organizations.');
  }

  const [row] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (!row) throw new DomainNotFoundError('Organization', input.organizationId);
  return toOrganizationDto(row);
}
