import { StateTransitionConflictError, type OrganizationStatus } from '@vercentlabs/contracts';

/**
 * Organization state machine (SP001). Each command asserts the *specific*
 * prior status it requires, not just "is this status reachable" - ACTIVE is
 * reachable both from DRAFT (via activate) and is the target of recovery
 * from SUSPENDED, and those are different commands with different
 * authorization/audit semantics, not one generic "set status" mutation.
 *
 *   DRAFT -> ACTIVE      (activate)
 *   ACTIVE -> SUSPENDED  (suspend)
 *   SUSPENDED -> ACTIVE  (recover)
 *   DRAFT|ACTIVE|SUSPENDED -> CLOSED (close)
 *   CLOSED is terminal - no command ever reads a current status of CLOSED
 *   as valid.
 */

export function assertCanActivateOrganization(current: OrganizationStatus): void {
  if (current !== 'DRAFT') {
    throw new StateTransitionConflictError('Organization', current, 'ACTIVE');
  }
}

export function assertCanSuspendOrganization(current: OrganizationStatus): void {
  if (current !== 'ACTIVE') {
    throw new StateTransitionConflictError('Organization', current, 'SUSPENDED');
  }
}

export function assertCanRecoverOrganization(current: OrganizationStatus): void {
  if (current !== 'SUSPENDED') {
    throw new StateTransitionConflictError('Organization', current, 'ACTIVE');
  }
}

export function assertCanCloseOrganization(current: OrganizationStatus): void {
  if (current !== 'DRAFT' && current !== 'ACTIVE' && current !== 'SUSPENDED') {
    throw new StateTransitionConflictError('Organization', current, 'CLOSED');
  }
}

/** Display-metadata updates are allowed for any non-terminal status. */
export function assertCanUpdateOrganizationMetadata(current: OrganizationStatus): void {
  if (current === 'CLOSED') {
    throw new StateTransitionConflictError('Organization', current, current);
  }
}
