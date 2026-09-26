import { queueLeadEnrichment, reviewLeadEnrichment, requireSessionPermission } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// Ported from the recovered pre-rebuild snapshot (last present at commit d4df5eb1), apps/web/src/
// app/api/crm/lead-acquisition/enrichment/route.ts — the underlying
// queueLeadEnrichment/reviewLeadEnrichment functions already exist live in
// @vercentlabs/api; only the thin HTTP wrapper needed rebuilding.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session }) => {
    requireSessionPermission(session, CRM_PERMISSIONS.dataQualityManage);
    requireSessionPermission(session, CRM_PERMISSIONS.leadsViewSensitive);
    const input = (await readJson(request)) as Record<string, unknown>;
    const result = await (input.action === "review"
      ? reviewLeadEnrichment(client, crmContext(session), String(input.reviewId || ""), input)
      : queueLeadEnrichment(client, crmContext(session), input));
    return ok({ result }, input.action === "review" ? 200 : 201);
  });
}
