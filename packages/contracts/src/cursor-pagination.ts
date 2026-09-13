import { z } from 'zod';

export const cursorPaginationRequestSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type CursorPaginationRequest = z.infer<typeof cursorPaginationRequestSchema>;

export interface CursorPageResult<T> {
  items: T[];
  nextCursor: string | null;
}

const cursorPayloadSchema = z.object({
  createdAt: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
});
export type CursorPayload = z.infer<typeof cursorPayloadSchema>;

// btoa/atob (not Buffer) so this works unchanged in both Node and browser
// bundles - packages/contracts must stay runtime-agnostic.
function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const base64 = padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '=');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Encodes a stable (createdAt, id) tuple into an opaque pagination cursor. */
export function encodeCursor(payload: CursorPayload): string {
  return toBase64Url(JSON.stringify(payload));
}

/** Returns null for a malformed/tampered cursor rather than throwing - callers should treat that as a validation error. */
export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const json = fromBase64Url(cursor);
    const result = cursorPayloadSchema.safeParse(JSON.parse(json));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
