import { StateTransitionConflictError } from '@vercentlabs/contracts';
import { describe, expect, it } from 'vitest';
import {
  assertCanActivateUser,
  assertCanDeactivateUser,
  assertCanReactivateUser,
  assertCanSuspendUser,
  canCreateSession,
} from '../src/status.js';

describe('user lifecycle state machine', () => {
  it('allows INVITED -> ACTIVE via activation', () => {
    expect(() => assertCanActivateUser('INVITED')).not.toThrow();
  });
  it('rejects activating a non-INVITED user', () => {
    expect(() => assertCanActivateUser('ACTIVE')).toThrow(StateTransitionConflictError);
    expect(() => assertCanActivateUser('SUSPENDED')).toThrow(StateTransitionConflictError);
    expect(() => assertCanActivateUser('DEACTIVATED')).toThrow(StateTransitionConflictError);
  });

  it('allows ACTIVE -> SUSPENDED', () => {
    expect(() => assertCanSuspendUser('ACTIVE')).not.toThrow();
  });
  it('rejects suspending a non-ACTIVE user', () => {
    expect(() => assertCanSuspendUser('INVITED')).toThrow(StateTransitionConflictError);
    expect(() => assertCanSuspendUser('SUSPENDED')).toThrow(StateTransitionConflictError);
    expect(() => assertCanSuspendUser('DEACTIVATED')).toThrow(StateTransitionConflictError);
  });

  it('allows SUSPENDED -> ACTIVE via reactivation', () => {
    expect(() => assertCanReactivateUser('SUSPENDED')).not.toThrow();
  });
  it('rejects reactivating a non-SUSPENDED user', () => {
    expect(() => assertCanReactivateUser('ACTIVE')).toThrow(StateTransitionConflictError);
  });

  it('allows ACTIVE|SUSPENDED -> DEACTIVATED', () => {
    expect(() => assertCanDeactivateUser('ACTIVE')).not.toThrow();
    expect(() => assertCanDeactivateUser('SUSPENDED')).not.toThrow();
  });
  it('DEACTIVATED is terminal - rejects deactivating an already-deactivated user', () => {
    expect(() => assertCanDeactivateUser('DEACTIVATED')).toThrow(StateTransitionConflictError);
  });
  it('rejects deactivating an INVITED user directly', () => {
    expect(() => assertCanDeactivateUser('INVITED')).toThrow(StateTransitionConflictError);
  });

  it('only ACTIVE users may create sessions', () => {
    expect(canCreateSession('ACTIVE')).toBe(true);
    expect(canCreateSession('INVITED')).toBe(false);
    expect(canCreateSession('SUSPENDED')).toBe(false);
    expect(canCreateSession('DEACTIVATED')).toBe(false);
  });
});
