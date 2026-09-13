import { StateTransitionConflictError } from '@vercentlabs/contracts';
import { describe, expect, it } from 'vitest';
import {
  assertCanActivateOrganization,
  assertCanCloseOrganization,
  assertCanRecoverOrganization,
  assertCanSuspendOrganization,
  assertCanUpdateOrganizationMetadata,
} from '../src/status.js';

describe('organization state machine: activate (-> ACTIVE, requires DRAFT)', () => {
  it('allows DRAFT -> ACTIVE', () => {
    expect(() => assertCanActivateOrganization('DRAFT')).not.toThrow();
  });

  it('rejects ACTIVE -> ACTIVE (no re-activation disguised as activation)', () => {
    expect(() => assertCanActivateOrganization('ACTIVE')).toThrow(StateTransitionConflictError);
  });

  it('rejects SUSPENDED -> ACTIVE via activate (must go through recover)', () => {
    expect(() => assertCanActivateOrganization('SUSPENDED')).toThrow(StateTransitionConflictError);
  });

  it('rejects CLOSED -> ACTIVE', () => {
    expect(() => assertCanActivateOrganization('CLOSED')).toThrow(StateTransitionConflictError);
  });
});

describe('organization state machine: suspend (-> SUSPENDED, requires ACTIVE)', () => {
  it('allows ACTIVE -> SUSPENDED', () => {
    expect(() => assertCanSuspendOrganization('ACTIVE')).not.toThrow();
  });

  it('rejects DRAFT -> SUSPENDED', () => {
    expect(() => assertCanSuspendOrganization('DRAFT')).toThrow(StateTransitionConflictError);
  });

  it('rejects SUSPENDED -> SUSPENDED', () => {
    expect(() => assertCanSuspendOrganization('SUSPENDED')).toThrow(StateTransitionConflictError);
  });

  it('rejects CLOSED -> SUSPENDED', () => {
    expect(() => assertCanSuspendOrganization('CLOSED')).toThrow(StateTransitionConflictError);
  });
});

describe('organization state machine: recover (-> ACTIVE, requires SUSPENDED)', () => {
  it('allows SUSPENDED -> ACTIVE', () => {
    expect(() => assertCanRecoverOrganization('SUSPENDED')).not.toThrow();
  });

  it('rejects DRAFT -> ACTIVE via recover', () => {
    expect(() => assertCanRecoverOrganization('DRAFT')).toThrow(StateTransitionConflictError);
  });

  it('rejects ACTIVE -> ACTIVE via recover', () => {
    expect(() => assertCanRecoverOrganization('ACTIVE')).toThrow(StateTransitionConflictError);
  });

  it('rejects CLOSED -> ACTIVE via recover', () => {
    expect(() => assertCanRecoverOrganization('CLOSED')).toThrow(StateTransitionConflictError);
  });
});

describe('organization state machine: close (-> CLOSED, terminal)', () => {
  it('allows DRAFT -> CLOSED', () => {
    expect(() => assertCanCloseOrganization('DRAFT')).not.toThrow();
  });

  it('allows ACTIVE -> CLOSED', () => {
    expect(() => assertCanCloseOrganization('ACTIVE')).not.toThrow();
  });

  it('allows SUSPENDED -> CLOSED', () => {
    expect(() => assertCanCloseOrganization('SUSPENDED')).not.toThrow();
  });

  it('rejects CLOSED -> CLOSED (terminal, no implicit deletion or re-closure)', () => {
    expect(() => assertCanCloseOrganization('CLOSED')).toThrow(StateTransitionConflictError);
  });
});

describe('organization state machine: update display metadata', () => {
  it.each(['DRAFT', 'ACTIVE', 'SUSPENDED'] as const)(
    'allows metadata updates while %s',
    (status) => {
      expect(() => assertCanUpdateOrganizationMetadata(status)).not.toThrow();
    },
  );

  it('rejects metadata updates once CLOSED', () => {
    expect(() => assertCanUpdateOrganizationMetadata('CLOSED')).toThrow(
      StateTransitionConflictError,
    );
  });
});
