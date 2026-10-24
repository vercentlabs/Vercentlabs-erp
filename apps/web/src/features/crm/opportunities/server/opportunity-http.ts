import "server-only";

export { csvResponse, readBody } from "@/features/crm/leads/server/lead-http";

// Request helpers shared by the opportunity routes under
// /api/crm/opportunities. Each route is a thin shell: workspaceRoute
// authenticates and opens the tenant transaction, then the route calls one
// opportunity operation from @vercentlabs/api/crm, which owns every rule.
export type OpportunityRouteParams = { params: Promise<{ id: string }> };

const FILTER_KEYS = [
  "view", "search", "status", "stageId", "ownerId", "teamId", "accountId", "contactId", "product", "sourceId", "priority", "lostReasonId", "leadId",
  "expectedCloseFrom", "expectedCloseTo", "closedFrom", "closedTo", "valueMin", "valueMax", "createdFrom", "createdTo", "stale", "highValue", "noNextActivity", "sortBy", "sortDirection", "groupBy", "cardSort", "cardsPerStage", "campaignId", "medium", "tagId", "pipelineId", "recurringPlanId", "recurring",
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
  // Custom fields as filters (cf.<key>=value): the record's own fields (CRM audit M4).
  const custom = Object.fromEntries([...url.searchParams].filter(([key, value]) => key.startsWith("cf.") && value).map(([key, value]) => [key.slice(3), value]));
  if (Object.keys(custom).length) filters.custom = custom;
  return filters;
}
