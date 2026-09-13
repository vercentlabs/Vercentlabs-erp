import { describe, expect, it } from 'vitest';
import { normalizeEmail } from '../src/normalize-email.js';

describe('normalizeEmail', () => {
  it('lowercases the whole address', () => {
    expect(normalizeEmail('User.Name@Example.COM')).toBe('user.name@example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeEmail('  user@example.com  ')).toBe('user@example.com');
  });

  it('does NOT apply Gmail-style dot removal', () => {
    expect(normalizeEmail('u.s.e.r@gmail.com')).toBe('u.s.e.r@gmail.com');
    expect(normalizeEmail('user@gmail.com')).not.toBe(normalizeEmail('u.s.e.r@gmail.com'));
  });

  it('does NOT collapse plus-addressing', () => {
    expect(normalizeEmail('user+tag@example.com')).toBe('user+tag@example.com');
    expect(normalizeEmail('user+tag@example.com')).not.toBe(normalizeEmail('user@example.com'));
  });

  it('is deterministic', () => {
    const email = 'Mixed.Case+Tag@Example.COM';
    expect(normalizeEmail(email)).toBe(normalizeEmail(normalizeEmail(email)));
  });
});
