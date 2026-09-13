import { describe, expect, it } from 'vitest';
import {
  codeInputSchema,
  decodeCursor,
  encodeCursor,
  isValidCountryCode,
  isValidCurrencyCode,
  isValidIanaTimeZoneName,
  isValidNormalizedCode,
  normalizeCode,
} from '../src/index.js';

describe('code normalization', () => {
  it('trims and uppercases raw input', () => {
    expect(normalizeCode('  acme-01 ')).toBe('ACME-01');
  });

  it.each(['ACME', 'ACME-01', 'ACME_01', 'A', 'A1'])(
    'accepts valid normalized code "%s"',
    (code) => {
      expect(isValidNormalizedCode(code)).toBe(true);
    },
  );

  it.each(['', '-ACME', 'ACME-', 'ACME!', 'acme', 'A'.repeat(33)])(
    'rejects invalid code "%s"',
    (code) => {
      expect(isValidNormalizedCode(code)).toBe(false);
    },
  );

  it('codeInputSchema normalizes then validates', () => {
    expect(codeInputSchema.parse('  acme-01 ')).toBe('ACME-01');
    expect(() => codeInputSchema.parse('   ')).toThrow();
  });
});

describe('ISO currency/country validation', () => {
  it('accepts real currency codes case-insensitively', () => {
    expect(isValidCurrencyCode('USD')).toBe(true);
    expect(isValidCurrencyCode('usd')).toBe(true);
    expect(isValidCurrencyCode('INR')).toBe(true);
  });

  it('rejects a made-up currency code', () => {
    expect(isValidCurrencyCode('ZZZ')).toBe(false);
  });

  it('accepts real country codes case-insensitively', () => {
    expect(isValidCountryCode('US')).toBe(true);
    expect(isValidCountryCode('in')).toBe(true);
  });

  it('rejects a made-up country code', () => {
    expect(isValidCountryCode('ZZ')).toBe(false);
  });
});

describe('IANA time zone validation', () => {
  it('accepts a real time zone', () => {
    expect(isValidIanaTimeZoneName('Asia/Kolkata')).toBe(true);
    expect(isValidIanaTimeZoneName('America/New_York')).toBe(true);
  });

  it('rejects a bogus time zone', () => {
    expect(isValidIanaTimeZoneName('Not/AZone')).toBe(false);
  });
});

describe('cursor pagination', () => {
  it('round-trips a cursor payload', () => {
    const payload = {
      createdAt: '2026-01-01T00:00:00.000Z',
      id: '00000000-0000-4000-8000-000000000001',
    };
    const cursor = encodeCursor(payload);
    expect(decodeCursor(cursor)).toEqual(payload);
  });

  it('returns null for a tampered/malformed cursor', () => {
    expect(decodeCursor('not-a-real-cursor!!!')).toBeNull();
  });

  it('produces a URL-safe, non-empty opaque string', () => {
    const cursor = encodeCursor({
      createdAt: '2026-01-01T00:00:00.000Z',
      id: '00000000-0000-4000-8000-000000000001',
    });
    expect(cursor.length).toBeGreaterThan(0);
    expect(cursor).not.toMatch(/[+/=]/);
  });
});
