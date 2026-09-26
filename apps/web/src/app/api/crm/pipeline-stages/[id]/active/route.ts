import { setSalesStageActive } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError, ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const body = (await readJson(request)) as { active?: boolean; expectedUpdatedAt?: string };
    if (!body.expectedUpdatedAt) throw new HttpError(400, "Refresh the stage and submit its current version.");
    const record = await setSalesStageActive(client, crmContext(session), id, Boolean(body.active), body.expectedUpdatedAt as string);
    return ok({ record });
  });
}
