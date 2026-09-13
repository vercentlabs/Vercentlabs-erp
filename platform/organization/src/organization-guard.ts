import { DomainNotFoundError, DomainValidationError } from '@vercentlabs/contracts';
import { findOrganizationById, type OrganizationRow } from '@vercentlabs/platform-tenancy';
import type { QueryExecutor } from './tx.js';

/**
 * SP002/SP003 depend on SP001: every company/operating-unit write must be
 * checked against its parent organization's real current state, not an
 * assumption. Calls platform/tenancy's own exported (public) repository
 * read - cross-module reads go through the owning module's public surface,
 * never a direct query against another module's private table.
 */
export async function loadOrganizationAcceptingNewCompanies(
  db: QueryExecutor,
  organizationId: string,
): Promise<OrganizationRow> {
  const organization = await findOrganizationById(db, organizationId);
  if (!organization) {
    throw new DomainNotFoundError('Organization', organizationId);
  }
  if (organization.status === 'SUSPENDED' || organization.status === 'CLOSED') {
    throw new DomainValidationError(
      `Organization is ${organization.status} and cannot accept new companies or operating units.`,
      [{ field: 'organizationId', message: `organization is ${organization.status}` }],
    );
  }
  return organization;
}
