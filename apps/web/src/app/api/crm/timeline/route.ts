import { getCrmRecordTimelinePage } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F019 — one merged, cursor-paginated activity timeline for any CRM record
// (lead / opportunity / account / contact). Authorization, per-kind privacy
// and pagination are getCrmRecordTimelinePage's own authority; this route
// only forwards the filters. It replaces the lead/opportunity-only routes,
// which fetched a single first page.
type TimelineEntityType = Parameters<typeof getCrmRecordTimelinePage>[2];

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const entityType = url.searchParams.get("entityType") ?? "";
    const entityId = url.searchParams.get("entityId") ?? "";
    const cursor = url.searchParams.get("cursor") || undefined;
    const limitParam = url.searchParams.get("limit");
    const kindsParam = url.searchParams.get("kinds")?.split(",").filter(Boolean);
    type TimelineKind = NonNullable<Parameters<typeof getCrmRecordTimelinePage>[4]>["kinds"] extends (infer K)[] | undefined ? K : never;
    const kinds = kindsParam as TimelineKind[] | undefined;
    const page = await getCrmRecordTimelinePage(client, crmContext(session), entityType as TimelineEntityType, entityId, {
      cursor,
      limit: limitParam ? Number(limitParam) : undefined,
      kinds,
    });
    return ok({ page });
  });
}
