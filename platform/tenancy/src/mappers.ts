import type { OrganizationDto, OrganizationStatus } from '@vercentlabs/contracts';
import type { OrganizationRow } from './schema.js';

export function toOrganizationDto(row: OrganizationRow): OrganizationDto {
  return {
    id: row.id,
    tenantKey: row.tenantKey,
    displayName: row.displayName,
    legalMetadata: (row.legalMetadata as Record<string, unknown> | null) ?? null,
    status: row.status as OrganizationStatus,
    statusReason: row.statusReason,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    activatedAt: row.activatedAt?.toISOString() ?? null,
    suspendedAt: row.suspendedAt?.toISOString() ?? null,
    recoveredAt: row.recoveredAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
  };
}
