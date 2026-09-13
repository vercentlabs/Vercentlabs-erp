import { z } from 'zod';

/**
 * Optimistic-concurrency header. Every update or lifecycle-transition
 * command must require the caller's last-known version via this header (or
 * an equivalent explicit `expectedVersion` request field for commands that
 * are not plain HTTP method updates) - never "last write wins".
 */
export const IF_MATCH_HEADER = 'if-match';

export const expectedVersionSchema = z.coerce.number().int().min(1);
export type ExpectedVersion = z.infer<typeof expectedVersionSchema>;

/** Parses an `If-Match` header value (a bare integer version, not a quoted ETag) into a version number. */
export function parseIfMatchHeader(value: string | undefined): ExpectedVersion | undefined {
  if (!value) return undefined;
  const unquoted = value.replace(/^"|"$/g, '');
  const result = expectedVersionSchema.safeParse(unquoted);
  return result.success ? result.data : undefined;
}
