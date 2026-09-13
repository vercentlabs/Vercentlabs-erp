import { randomInt } from 'node:crypto';

// Crockford-ish alphabet with ambiguous characters (0/O, 1/I/L) removed, so
// a human transcribing a printed/downloaded code by hand cannot mistake one
// character for another.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GROUP_LENGTH = 5;
const GROUP_COUNT = 4; // 20 symbols total from a 32-symbol alphabet = 100 bits of entropy per code.

/** Generates one cryptographically random, human-transcribable recovery code, e.g. "AB3XY-9KLMN-QRST2-4VWXY". */
export function generateRecoveryCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUP_COUNT; g += 1) {
    let group = '';
    for (let i = 0; i < GROUP_LENGTH; i += 1) {
      group += ALPHABET[randomInt(ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join('-');
}

/** Recovery codes are compared by normalized form (uppercase, hyphens stripped) so a user retyping one is not tripped up by case or spacing. */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function generateRecoveryCodeBatch(count = 10): string[] {
  return Array.from({ length: count }, () => generateRecoveryCode());
}
