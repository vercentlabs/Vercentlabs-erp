import { assertSameOriginOrMobile, createCrmRecord, isCrmResource, listCrmRecords } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess, requireCrmMutationAccess } from "@/features/crm/shared/crm-context";

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
  "periodId",
  "dwellBreached",
  "highPriority",
  "stalled",
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
// opportunities, activities, sources, tags, saved-views, etc.), not just
// leads, so Accounts/Contacts-adjacent and future CRM screens reuse the
// same boundary rather than each inventing their own.
export async function GET(request: Request, context: { params: Promise<{ resource: string }> }) {
  try {
    const session = await requireWorkspace();
    const { resource } = await context.params;
    if (!isCrmResource(resource)) throw new HttpError(404, "Unknown CRM resource.");
    const url = new URL(request.url);
    const filters = parseListFilters(url);
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return listCrmRecords(client, crmContext(session), resource, filters);
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ resource: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { resource } = await context.params;
    if (!isCrmResource(resource)) throw new HttpError(404, "Unknown CRM resource.");
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmMutationAccess(client, session, resource);
      return createCrmRecord(client, crmContext(session), resource, input);
    });
    return ok({ record }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
