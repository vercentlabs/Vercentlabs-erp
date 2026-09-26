import { getLeadStageDwell, isElevatedLifecycleActor, listLeadStageHistory, transitionLeadStage } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// Lead stage: dwell and history (read), and governed transitions.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm", action: "crm.lead.stage.view" }, async ({ client, session }) => {
    const { id } = await context.params;
    const ctx = crmContext(session);
    const dwell = await getLeadStageDwell(client, ctx, id);
    const history = await listLeadStageHistory(client, ctx, id);
    return ok({ dwell, history, canOverride: isElevatedLifecycleActor(ctx) });
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsManage, billingWrite: true, action: "crm.lead.stage.transition" }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = (await readJson(request)) as Record<string, unknown>;
    return ok(await transitionLeadStage(client, crmContext(session), id, input));
  });
}
