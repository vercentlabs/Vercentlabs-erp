import { createCrmRecord, isCrmResource, listCrmRecords, requireBillingWriteAccess } from "@vercentlabs/api";

import { HttpError, ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { assertCrmResourceMutationPermission, crmContext } from "@/features/crm/shared/crm-context";

const LIST_FILTER_KEYS = [
  "search",
  "status",
  "ownerId",
  "stageId",
  "pipelineId",
  "sourceId",
  "campaignId",
  "activityType",
  "priority",
  "rating",
  "followup",
  "qualification",
  "due",
  "opportunityId",
  "committeeId",
  "teamId",
  "territoryId",
  "partyId",
  "accountPlanId",
  "contactId",
  "leadId",
  "periodId",
  "dwellBreached",
  "highPriority",
  "stalled",
  // F024/F025 — dashboard and forecast drill-down. Without these the list
  // silently dropped the date/category predicates and showed every record
  // for the owner, so a figure and its list stopped reconciling.
  "createdFrom",
  "createdTo",
  "convertedFrom",
  "convertedTo",
  "includeConverted",
  "closedFrom",
  "closedTo",
  "expectedCloseFrom",
  "expectedCloseTo",
  "forecastCategory",
  "outcomeReasonId",
] as const;

function parseListFilters(url: URL) {
  const filters: Record<string, unknown> = {};
  for (const key of LIST_FILTER_KEYS) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  const limit = url.searchParams.get("limit");
  const offset = url.searchParams.get("offset");
  if (limit) filters.limit = Number(limit);
  if (offset) filters.offset = Number(offset);
  return filters;
}

// Governed generic CRM resource boundary (Phase 5/6). Thin by design: this
// route authenticates, resolves workspace + CRM context, validates the
// resource key, opens a tenant-scoped transaction, and delegates entirely
// to @vercentlabs/api's resource-registry-driven listCrmRecords/
// createCrmRecord — no CRM business logic (assignment, scoring, lifecycle
// rules) lives here. Covers every CRM_RESOURCE_KEYS entry (leads,
// opportunities, activities, sources, tags, etc.), not just
// leads, so Accounts/Contacts-adjacent and future CRM screens reuse the
// same boundary rather than each inventing their own.
export async function GET(request: Request, context: { params: Promise<{ resource: string }> }) {
  return workspaceRoute(request, { module: "crm", action: "crm.resource.list" }, async ({ client, session }) => {
    const { resource } = await context.params;
    if (!isCrmResource(resource)) throw new HttpError(404, "Unknown CRM resource.");
    return ok(await listCrmRecords(client, crmContext(session), resource, parseListFilters(new URL(request.url))));
  });
}

export async function POST(request: Request, context: { params: Promise<{ resource: string }> }) {
  return workspaceRoute(request, { module: "crm", action: "crm.resource.create" }, async ({ client, session }) => {
    const { resource } = await context.params;
    if (!isCrmResource(resource)) throw new HttpError(404, "Unknown CRM resource.");
    assertCrmResourceMutationPermission(session, resource);
    await requireBillingWriteAccess(client, session.organizationId, process.env);
    const input = (await readJson(request)) as Record<string, unknown>;
    return ok({ record: await createCrmRecord(client, crmContext(session), resource, input) }, 201);
  });
}
