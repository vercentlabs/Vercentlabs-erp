import "server-only";

// Request helpers for the contact routes under /api/crm/contacts. Each route
// is a thin shell: workspaceRoute authenticates and opens the tenant
// transaction, then the route calls one contact operation from
// @vercentlabs/api/crm, which owns every business rule.
export { csvResponse, readBody, readUpload } from "@/features/crm/leads/server/lead-http";

export type ContactRouteParams = { params: Promise<{ id: string }> };

const FILTER_KEYS = [
  "view", "search", "status", "accountId", "ownerId", "teamId", "department", "role", "sourceId", "countryCode",
  "createdFrom", "createdTo", "lastActivityBefore", "isDecisionMaker", "isPrimary", "tagId", "sortBy", "sortDirection",
] as const;

// The list filters accepted from the query string (list and export).
export function contactFiltersFromUrl(url: URL) {
  const filters: Record<string, unknown> = {};
  for (const key of FILTER_KEYS) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  for (const key of ["limit", "offset"]) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = Number(value);
  }
  const ids = url.searchParams.get("ids");
  if (ids) filters.ids = ids.split(",");
  return filters;
}
