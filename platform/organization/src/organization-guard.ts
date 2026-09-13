import { DomainNotFoundError, DomainValidationError } from '@vercentlabs/contracts';
import { findOrganizationById, type OrganizationRow } from '@vercentlabs/platform-tenancy';
import { withOrganizationScope } from '@vercentlabs/database';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/**
 * SP002/SP003 depend on SP001: every company/operating-unit write must be
 * checked against its parent organization's real current state, not an
 * assumption. Calls platform/tenancy's own exported (public) repository
 * read - cross-module reads go through the owning module's public surface,
 * never a direct query against another module's private table.
 *
 * Runs inside `withOrganizationScope(db, organizationId, ...)` - required
 * since `platform.organizations` now enforces Row-Level Security for the
 * `erp_runtime` role (see
 * database/migrations/platform/0007_harden_organizations_tenant_boundary.sql):
 * an unscoped read would see zero rows, and a read scoped to a *different*
 * organization would also see zero rows for this one. Takes the top-level
 * `NodePgDatabase`, not a `QueryExecutor`, precisely because it must open
 * its own transaction to set that scope - it cannot run inside an
 * already-open one.
 */
export async function loadOrganizationAcceptingNewCompanies(
  db: NodePgDatabase,
  organizationId: string,
): Promise<OrganizationRow> {
  const organization = await withOrganizationScope(db, organizationId, (tx) =>
    findOrganizationById(tx, organizationId),
  );
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
