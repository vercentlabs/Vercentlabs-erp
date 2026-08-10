// Pure, DB-free filter/pagination sanitizers shared by audit/query.ts and
// its API-route callers. Kept in their own file — with no @/lib/db
// dependency — so they can be executed directly in tests instead of only
// source-pattern-matched (same rationale as Prompt 8's internal-href.ts).
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
export const MAX_PAGE = 10_000;

export function sanitizeDate(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function sanitizePage(value?: number): number {
  const page = Math.trunc(Number(value) || 1);
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(page, MAX_PAGE);
}

export function sanitizePageSize(value?: number, fallback = DEFAULT_PAGE_SIZE): number {
  const size = Math.trunc(Number(value) || fallback);
  if (!Number.isFinite(size) || size < 1) return fallback;
  return Math.min(size, MAX_PAGE_SIZE);
}

// Only a small, known-safe set of event-type prefixes may ever be used to
// build a LIKE pattern — the value itself is still always passed as a
// bound parameter, never string-concatenated into query text.
export function sanitizeEventTypePrefix(value?: string): string | null {
  if (!value) return null;
  const trimmed = value.trim().slice(0, 60);
  if (!/^[a-z0-9_.-]+$/i.test(trimmed)) return null;
  return trimmed;
}
