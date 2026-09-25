import { getCrmRecordTimelinePage } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F019 — one merged, cursor-paginated activity timeline for any CRM record
// (lead / opportunity / account / contact). Authorization, per-kind privacy
// and pagination are getCrmRecordTimelinePage's own authority; this route
// only forwards the filters. It replaces the lead/opportunity-only routes,
// which fetched a single first page.
type TimelineEntityType = Parameters<typeof getCrmRecordTimelinePage>[2];

export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const entityType = url.searchParams.get("entityType") ?? "";
    const entityId = url.searchParams.get("entityId") ?? "";
    const cursor = url.searchParams.get("cursor") || undefined;
    const limitParam = url.searchParams.get("limit");
    const kindsParam = url.searchParams.get("kinds")?.split(",").filter(Boolean);
    type TimelineKind = NonNullable<Parameters<typeof getCrmRecordTimelinePage>[4]>["kinds"] extends (infer K)[] | undefined ? K : never;
    const kinds = kindsParam as TimelineKind[] | undefined;
    const page = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return getCrmRecordTimelinePage(client, crmContext(session), entityType as TimelineEntityType, entityId, {
        cursor,
        limit: limitParam ? Number(limitParam) : undefined,
        kinds,
      });
    });
    return ok({ page });
  } catch (error) {
    return errorResponse(error);
  }
}
