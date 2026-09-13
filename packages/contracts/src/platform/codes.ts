import { z } from 'zod';

const CODE_PATTERN = /^[A-Z0-9](?:[A-Z0-9_-]{0,30}[A-Z0-9])?$/;

/**
 * Normalizes a human-entered code (tenant key, company code, operating-unit
 * code) to its canonical stored/compared form: trimmed, uppercased. Codes
 * are immutable once created, so normalization must happen once, at
 * creation, not on every read.
 */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidNormalizedCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

/** Accepts raw input and normalizes it; rejects anything that isn't a valid code even after normalizing. */
export const codeInputSchema = z
  .string()
  .min(1)
  .transform(normalizeCode)
  .refine(isValidNormalizedCode, {
    message:
      'must be 1-32 characters of letters, digits, hyphen or underscore, not starting/ending with one',
  });

/** For fields already known to be normalized (e.g. read back from the database). */
export const normalizedCodeSchema = z.string().refine(isValidNormalizedCode, {
  message: 'must already be a normalized code',
});
