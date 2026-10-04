import "server-only";

export { csvResponse, readBody } from "@/features/crm/leads/server/lead-http";

// Request helpers shared by the task routes under /api/crm/tasks. Each route
// is a thin shell: workspaceRoute authenticates and opens the tenant
// transaction, then the route calls one task operation from
// @vercentlabs/api/crm, which owns every rule.
export type TaskRouteParams = { params: Promise<{ id: string }> };

const FILTER_KEYS = [
  "view", "search", "status", "priority", "assigneeId", "createdBy", "relatedType", "relatedId", "accountId", "leadId", "opportunityId", "contactId",
  "dueFrom", "dueTo", "createdFrom", "createdTo", "sortBy", "sortDirection",
] as const;

// The list filters accepted from the query string (list and export).
export function taskFiltersFromUrl(url: URL) {
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
