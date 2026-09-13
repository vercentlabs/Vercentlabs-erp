import { StateTransitionConflictError } from '@vercentlabs/contracts';

/**
 * SP004 user lifecycle:
 *
 *   INVITED -> ACTIVE       (accept invitation)
 *   ACTIVE -> SUSPENDED     (suspend)
 *   SUSPENDED -> ACTIVE     (reactivate)
 *   ACTIVE|SUSPENDED -> DEACTIVATED (deactivate)
 *   DEACTIVATED is terminal.
 *
 * Account lockout from authentication defence (auth.authentication_attempts)
 * is a separate, time-windowed, computed condition - it never appears here
 * and never sets any of these statuses.
 */
export type UserStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

export function assertCanActivateUser(current: UserStatus): void {
  if (current !== 'INVITED') {
    throw new StateTransitionConflictError('User', current, 'ACTIVE');
  }
}

export function assertCanSuspendUser(current: UserStatus): void {
  if (current !== 'ACTIVE') {
    throw new StateTransitionConflictError('User', current, 'SUSPENDED');
  }
}

export function assertCanReactivateUser(current: UserStatus): void {
  if (current !== 'SUSPENDED') {
    throw new StateTransitionConflictError('User', current, 'ACTIVE');
  }
}

export function assertCanDeactivateUser(current: UserStatus): void {
  if (current !== 'ACTIVE' && current !== 'SUSPENDED') {
    throw new StateTransitionConflictError('User', current, 'DEACTIVATED');
  }
}

/** Only ACTIVE users may authenticate/create new sessions. */
export function canCreateSession(status: UserStatus): boolean {
  return status === 'ACTIVE';
}
