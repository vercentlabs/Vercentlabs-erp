/**
 * Unicode normalization policy for passwords: NFC (canonical composition).
 *
 * A password entered on two different keyboards/input methods can produce
 * different byte sequences for what a human considers the identical
 * string (e.g. an accented character as one composed code point vs. a base
 * character plus a combining mark) - without normalization those hash to
 * different Argon2id digests and the user is locked out of their own
 * account. NFC (rather than NFKC/NFKD) is chosen deliberately: it merges
 * only canonically-equivalent representations and leaves *compatibility*
 * characters alone (fullwidth forms, ligatures, superscripts stay distinct
 * from their plain equivalents), so it never silently collapses two
 * strings a user would consider visibly different into the same password.
 * See docs/security/password-security.md.
 *
 * Applied identically at registration/enrollment and at every verification
 * - never applied to session tokens, recovery codes, or anything else that
 * is server-generated and does not pass through a keyboard.
 */
export function normalizePassword(password: string): string {
  return password.normalize('NFC');
}
