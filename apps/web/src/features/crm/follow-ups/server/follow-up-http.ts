import "server-only";

export { csvResponse, readBody } from "@/features/crm/leads/server/lead-http";

// Request helpers shared by the follow-up routes under /api/crm/follow-ups.
// Each route is a thin shell around one follow-up operation from
// @vercentlabs/api/crm, which owns every rule.
export type FollowUpRouteParams = { params: Promise<{ id: string }> };

const FILTER_KEYS = [
  "view", "search", "status", "type", "outcome", "assigneeId", "createdBy", "completedBy", "relatedType", "relatedId", "accountId", "contactId", "leadId",
  "opportunityId", "dueFrom", "dueTo", "createdFrom", "createdTo", "sortBy", "sortDirection",
] as const;

export function followUpFiltersFromUrl(url: URL) {
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
