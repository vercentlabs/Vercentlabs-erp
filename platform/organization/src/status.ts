import {
  StateTransitionConflictError,
  type CompanyStatus,
  type OperatingUnitStatus,
} from '@vercentlabs/contracts';

/**
 * Company (SP002) and operating-unit (SP003) share one state machine shape:
 *
 *   DRAFT -> ACTIVE       (activate)
 *   ACTIVE -> INACTIVE    (deactivate)
 *   INACTIVE -> ACTIVE    (reactivate)
 *   DRAFT|INACTIVE -> CLOSED (close)
 *   CLOSED is terminal.
 *
 * Note ACTIVE -> CLOSED is NOT allowed directly - an active company/unit
 * must be deactivated first. This differs from Organization, where
 * ACTIVE -> CLOSED is permitted via an explicit guarded closure command.
 */
type SharedLifecycleStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'CLOSED';

function assertCanActivate(entityType: string, current: SharedLifecycleStatus): void {
  if (current !== 'DRAFT') {
    throw new StateTransitionConflictError(entityType, current, 'ACTIVE');
  }
}

function assertCanDeactivate(entityType: string, current: SharedLifecycleStatus): void {
  if (current !== 'ACTIVE') {
    throw new StateTransitionConflictError(entityType, current, 'INACTIVE');
  }
}

function assertCanReactivate(entityType: string, current: SharedLifecycleStatus): void {
  if (current !== 'INACTIVE') {
    throw new StateTransitionConflictError(entityType, current, 'ACTIVE');
  }
}

function assertCanClose(entityType: string, current: SharedLifecycleStatus): void {
  if (current !== 'DRAFT' && current !== 'INACTIVE') {
    throw new StateTransitionConflictError(entityType, current, 'CLOSED');
  }
}

function assertCanUpdateMetadata(entityType: string, current: SharedLifecycleStatus): void {
  if (current === 'CLOSED') {
    throw new StateTransitionConflictError(entityType, current, current);
  }
}

/** Only ACTIVE scopes may receive new business writes - used by consumers of this capability, not by this package itself. */
export function isAcceptingBusinessWrites(status: SharedLifecycleStatus): boolean {
  return status === 'ACTIVE';
}

export const assertCanActivateCompany = (current: CompanyStatus): void =>
  assertCanActivate('Company', current);
export const assertCanDeactivateCompany = (current: CompanyStatus): void =>
  assertCanDeactivate('Company', current);
export const assertCanReactivateCompany = (current: CompanyStatus): void =>
  assertCanReactivate('Company', current);
export const assertCanCloseCompany = (current: CompanyStatus): void =>
  assertCanClose('Company', current);
export const assertCanUpdateCompanyMetadata = (current: CompanyStatus): void =>
  assertCanUpdateMetadata('Company', current);

export const assertCanActivateOperatingUnit = (current: OperatingUnitStatus): void =>
  assertCanActivate('OperatingUnit', current);
export const assertCanDeactivateOperatingUnit = (current: OperatingUnitStatus): void =>
  assertCanDeactivate('OperatingUnit', current);
export const assertCanReactivateOperatingUnit = (current: OperatingUnitStatus): void =>
  assertCanReactivate('OperatingUnit', current);
export const assertCanCloseOperatingUnit = (current: OperatingUnitStatus): void =>
  assertCanClose('OperatingUnit', current);
export const assertCanUpdateOperatingUnitMetadata = (current: OperatingUnitStatus): void =>
  assertCanUpdateMetadata('OperatingUnit', current);
