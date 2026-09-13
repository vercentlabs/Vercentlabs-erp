/**
 * Deterministic email normalization: lowercase the whole address, trim
 * surrounding whitespace. Deliberately NOT provider-specific - no Gmail
 * dot-removal, no plus-addressing collapse. Those are heuristics about a
 * specific provider's routing behavior, not part of the address's actual
 * identity, and applying them would make two genuinely different mailboxes
 * collide under one identity. See docs/architecture/identity-model.md.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
