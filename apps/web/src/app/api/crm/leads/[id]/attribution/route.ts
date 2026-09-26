import { getLeadAttributionTimeline } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// Read-only multi-touch attribution timeline for one Lead (see
// lead-attribution.js). getLeadAttributionTimeline already scopes to what
// this caller may see via leadScopeSql (company/branch/owner) — this route
// only enforces the module-access layer, same as leads/[id]/score.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const { id } = await context.params;
    const url = new URL(request.url);
    const model = url.searchParams.get("model") || undefined;
    const timeline = await getLeadAttributionTimeline(client, crmContext(session), id, { model });
    return ok({ timeline });
  });
}
