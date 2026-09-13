import { describe, expect, it } from 'vitest';
import {
  generateRecoveryCode,
  generateRecoveryCodeBatch,
  normalizeRecoveryCode,
} from '../src/crypto/recovery-code.js';

describe('recovery-code', () => {
  it('generates a code in the expected human-transcribable group format', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(
      /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/,
    );
  });

  it('never includes ambiguous characters (0/O, 1/I/L)', () => {
    const codes = generateRecoveryCodeBatch(50);
    for (const code of codes) {
      expect(code).not.toMatch(/[01ILO]/);
    }
  });

  it('generates a batch with no duplicates', () => {
    const codes = generateRecoveryCodeBatch(20);
    expect(new Set(codes).size).toBe(20);
  });

  it('normalizes case and hyphens for comparison', () => {
    const code = generateRecoveryCode();
    const messyRetyped = code.toLowerCase().replace(/-/g, ' ');
    expect(normalizeRecoveryCode(messyRetyped)).toBe(normalizeRecoveryCode(code));
  });

  it('normalization strips anything that is not an alphanumeric', () => {
    expect(normalizeRecoveryCode('ab-cd_ef gh')).toBe('ABCDEFGH');
  });
});
