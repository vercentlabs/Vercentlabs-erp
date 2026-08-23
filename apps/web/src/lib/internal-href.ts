// Pure, DB-free internal-destination validator for workspace links. Kept in
// its own file — with no
// @/lib/auth or @/lib/db dependency — so it can be executed directly in
// tests instead of only source-pattern-matched, and so both call sites stay
// on one shared definition of "is this a real internal route shape."
import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";

// Every real top-level workspace area an internal href is allowed to point
// into — the 12 business modules plus the shared platform surfaces
// this prompt and its predecessors actually ship. Kept as a static
// allowlist (not derived from the per-session filtered navigation tree)
// because write-time validation must check "is this a real destination
// shape at all," independent of whether the writing user currently has
// access to it — per-user accessibility is checked separately.
export const ALLOWED_INTERNAL_PATH_PREFIXES = new Set<string>([
  ...ERP_MODULE_CATALOG.map((module) => module.key),
  "dashboard",
  "master-data",
  "my-work",
  "tasks",
  "follow-ups",
  "exceptions",
  "notifications",
  "approvals",
  "audit-logs",
  "profile",
  "security",
  "settings",
  "search",
]);

export function isValidInternalHref(href: unknown): href is string {
  if (typeof href !== "string") return false;
  if (href.length < 2 || href.length > 400) return false;
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  if (/[\s<>"'`]/.test(href)) return false;
  if (/^\/(?:[a-z]+:)/i.test(href)) return false; // e.g. /javascript:, /http:
  const [, firstSegment] = href.split("/");
  return ALLOWED_INTERNAL_PATH_PREFIXES.has(firstSegment);
}
