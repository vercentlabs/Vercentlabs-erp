import "server-only";

export { csvResponse, readBody } from "@/features/crm/leads/server/lead-http";

// Request helpers shared by the opportunity routes under
// /api/crm/opportunities. Each route is a thin shell: workspaceRoute
// authenticates and opens the tenant transaction, then the route calls one
// opportunity operation from @vercentlabs/api/crm, which owns every rule.
export type OpportunityRouteParams = { params: Promise<{ id: string }> };

const FILTER_KEYS = [
  "view", "search", "status", "stageId", "ownerId", "teamId", "accountId", "contactId", "product", "sourceId", "priority", "lostReasonId", "leadId",
  "expectedCloseFrom", "expectedCloseTo", "closedFrom", "closedTo", "valueMin", "valueMax", "createdFrom", "createdTo", "stale", "sortBy", "sortDirection", "groupBy",
] as const;

// The list filters accepted from the query string (list, report and export).
export function opportunityFiltersFromUrl(url: URL) {
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
  if (ids) filters.ids = ids.split(",").filter(Boolean);
  return filters;
}
