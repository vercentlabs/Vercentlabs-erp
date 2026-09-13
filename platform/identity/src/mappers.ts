import type {
  OrganizationMembershipDto,
  SessionDto,
  UserDto,
  WebAuthnCredentialDto,
} from '@vercentlabs/contracts';
import type { UserRow } from './schema/identity.js';
import type { OrganizationMembershipRow } from './schema/identity.js';
import type { SessionRow } from './schema/sessions.js';
import type { WebAuthnCredentialRow } from './schema/credentials.js';

export function toUserDto(
  row: UserRow,
  primaryEmail: { emailOriginal: string; verifiedAt: Date | null } | undefined,
): UserDto {
  return {
    id: row.id,
    status: row.status as UserDto['status'],
    displayName: row.displayName,
    primaryEmail: primaryEmail?.emailOriginal ?? null,
    primaryEmailVerified: primaryEmail?.verifiedAt != null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toMembershipDto(row: OrganizationMembershipRow): OrganizationMembershipDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    status: row.status as OrganizationMembershipDto['status'],
    joinedAt: row.joinedAt.toISOString(),
  };
}

export function toSessionDto(row: SessionRow, currentSessionId: string): SessionDto {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    assuranceLevel: row.assuranceLevel as SessionDto['assuranceLevel'],
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    deviceLabel: row.deviceLabel,
    isCurrent: row.id === currentSessionId,
  };
}

export function toWebAuthnCredentialDto(row: WebAuthnCredentialRow): WebAuthnCredentialDto {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    deviceType: row.deviceType,
    backedUp: row.backedUp,
  };
}
