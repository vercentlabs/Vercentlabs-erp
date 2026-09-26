import { reorderSalesStages } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError, ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session }) => {
    const body = (await readJson(request)) as { pipelineId?: string; entries?: Array<{ id: string; expectedUpdatedAt: string }> };
    if (!body.pipelineId) throw new HttpError(400, "A pipeline is required.");
    const result = await reorderSalesStages(client, crmContext(session), body.pipelineId as string, body.entries ?? []);
    return ok(result);
  });
}
