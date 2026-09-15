import { assertSameOrigin, queueLeadEnrichment, reviewLeadEnrichment, requireSessionPermission } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext } from "@/features/crm/shared/crm-context";

// Ported from docs/frontend-rebuild/recovered-platform-code/apps/web/src/
// app/api/crm/lead-acquisition/enrichment/route.ts — the underlying
// queueLeadEnrichment/reviewLeadEnrichment functions already exist live in
// @vercentlabs/api; only the thin HTTP wrapper needed rebuilding.
export async function POST(request: Request) {
  try {
    assertSameOrigin(request, process.env);
    const session = await requireWorkspace();
    requireSessionPermission(session, CRM_PERMISSIONS.dataQualityManage);
    requireSessionPermission(session, CRM_PERMISSIONS.leadsViewSensitive);
    const input = (await readJson(request)) as Record<string, unknown>;
    const result = await tenantTransaction(session.organizationId, (client) =>
      input.action === "review"
        ? reviewLeadEnrichment(client, crmContext(session), String(input.reviewId || ""), input)
        : queueLeadEnrichment(client, crmContext(session), input),
    );
    return ok({ result }, input.action === "review" ? 200 : 201);
  } catch (error) {
    return errorResponse(error);
  }
}
