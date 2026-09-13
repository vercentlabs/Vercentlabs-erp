import { StateTransitionConflictError } from '@vercentlabs/contracts';
import { describe, expect, it } from 'vitest';
import {
  assertCanActivateCompany,
  assertCanActivateOperatingUnit,
  assertCanCloseCompany,
  assertCanCloseOperatingUnit,
  assertCanDeactivateCompany,
  assertCanDeactivateOperatingUnit,
  assertCanReactivateCompany,
  assertCanReactivateOperatingUnit,
  assertCanUpdateCompanyMetadata,
  assertCanUpdateOperatingUnitMetadata,
  isAcceptingBusinessWrites,
} from '../src/status.js';

describe.each([
  {
    entity: 'company',
    activate: assertCanActivateCompany,
    deactivate: assertCanDeactivateCompany,
    reactivate: assertCanReactivateCompany,
    close: assertCanCloseCompany,
    updateMetadata: assertCanUpdateCompanyMetadata,
  },
  {
    entity: 'operating unit',
    activate: assertCanActivateOperatingUnit,
    deactivate: assertCanDeactivateOperatingUnit,
    reactivate: assertCanReactivateOperatingUnit,
    close: assertCanCloseOperatingUnit,
    updateMetadata: assertCanUpdateOperatingUnitMetadata,
  },
])('$entity state machine', ({ activate, deactivate, reactivate, close, updateMetadata }) => {
  describe('activate (-> ACTIVE, requires DRAFT)', () => {
    it('allows DRAFT -> ACTIVE', () => {
      expect(() => activate('DRAFT')).not.toThrow();
    });
    it('rejects ACTIVE -> ACTIVE', () => {
      expect(() => activate('ACTIVE')).toThrow(StateTransitionConflictError);
    });
    it('rejects INACTIVE -> ACTIVE via activate (must use reactivate)', () => {
      expect(() => activate('INACTIVE')).toThrow(StateTransitionConflictError);
    });
    it('rejects CLOSED -> ACTIVE', () => {
      expect(() => activate('CLOSED')).toThrow(StateTransitionConflictError);
    });
  });

  describe('deactivate (-> INACTIVE, requires ACTIVE)', () => {
    it('allows ACTIVE -> INACTIVE', () => {
      expect(() => deactivate('ACTIVE')).not.toThrow();
    });
    it('rejects DRAFT -> INACTIVE', () => {
      expect(() => deactivate('DRAFT')).toThrow(StateTransitionConflictError);
    });
    it('rejects CLOSED -> INACTIVE', () => {
      expect(() => deactivate('CLOSED')).toThrow(StateTransitionConflictError);
    });
  });

  describe('reactivate (-> ACTIVE, requires INACTIVE)', () => {
    it('allows INACTIVE -> ACTIVE', () => {
      expect(() => reactivate('INACTIVE')).not.toThrow();
    });
    it('rejects DRAFT -> ACTIVE via reactivate', () => {
      expect(() => reactivate('DRAFT')).toThrow(StateTransitionConflictError);
    });
    it('rejects CLOSED -> ACTIVE via reactivate', () => {
      expect(() => reactivate('CLOSED')).toThrow(StateTransitionConflictError);
    });
  });

  describe('close (-> CLOSED, terminal)', () => {
    it('allows DRAFT -> CLOSED', () => {
      expect(() => close('DRAFT')).not.toThrow();
    });
    it('allows INACTIVE -> CLOSED', () => {
      expect(() => close('INACTIVE')).not.toThrow();
    });
    it('rejects ACTIVE -> CLOSED directly (must deactivate first)', () => {
      expect(() => close('ACTIVE')).toThrow(StateTransitionConflictError);
    });
    it('rejects CLOSED -> CLOSED', () => {
      expect(() => close('CLOSED')).toThrow(StateTransitionConflictError);
    });
  });

  describe('update metadata', () => {
    it.each(['DRAFT', 'ACTIVE', 'INACTIVE'] as const)(
      'allows metadata updates while %s',
      (status) => {
        expect(() => updateMetadata(status)).not.toThrow();
      },
    );
    it('rejects metadata updates once CLOSED', () => {
      expect(() => updateMetadata('CLOSED')).toThrow(StateTransitionConflictError);
    });
  });
});

describe('isAcceptingBusinessWrites', () => {
  it('is true only for ACTIVE', () => {
    expect(isAcceptingBusinessWrites('ACTIVE')).toBe(true);
    expect(isAcceptingBusinessWrites('DRAFT')).toBe(false);
    expect(isAcceptingBusinessWrites('INACTIVE')).toBe(false);
    expect(isAcceptingBusinessWrites('CLOSED')).toBe(false);
  });
});
