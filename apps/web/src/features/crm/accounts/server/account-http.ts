import "server-only";

// Request helpers for the account routes under /api/crm/accounts. Each route
// is a thin shell: workspaceRoute authenticates and opens the tenant
// transaction, then the route calls one account operation from
// @vercentlabs/api/crm, which owns every business rule. Body, upload and CSV
// helpers are shared with the lead routes.
export { csvResponse, readBody, readUpload } from "@/features/crm/leads/server/lead-http";

export type AccountRouteParams = { params: Promise<{ id: string }> };

const FILTER_KEYS = [
  "view", "search", "accountType", "status", "industry", "sourceId", "teamId", "ownerId", "countryCode", "state",
  "createdFrom", "createdTo", "lastActivityBefore", "hasOpenOpportunity", "isCustomer", "tagId", "sortBy", "sortDirection", "groupBy",
] as const;

// The list filters accepted from the query string (list, summary, export, report).
export function accountFiltersFromUrl(url: URL) {
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
