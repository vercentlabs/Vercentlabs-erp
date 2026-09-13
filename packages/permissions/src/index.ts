import type { TrustedScope } from '@vercentlabs/contracts';

/**
 * Type-only scaffolding for SP008 (roles and permission model) and SP009
 * (record, field and contextual access control). No enforcement logic is
 * implemented in this prompt - see product/registers/shared-platform.yaml.
 */

export interface Permission {
  resource: string;
  action: string;
}

export interface Role {
  roleId: string;
  name: string;
  permissions: Permission[];
}

export interface AccessDecision {
  allowed: boolean;
  reason?: string;
}

/** To be implemented alongside SP009. Every check must take a server-derived TrustedScope, never a client-asserted one. */
export interface PermissionChecker {
  check(scope: TrustedScope, permission: Permission): Promise<AccessDecision>;
}

export function denyAccess(reason: string): AccessDecision {
  return { allowed: false, reason };
}

export function allowAccess(): AccessDecision {
  return { allowed: true };
}
