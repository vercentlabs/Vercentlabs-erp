import { addLeadStageTransition, listLeadStageTransitions } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const rows = await listLeadStageTransitions(client, crmContext(session));
    return ok({ rows });
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session }) => {
    const body = (await readJson(request)) as { fromStageId?: string; toStageId?: string; reasonRequired?: boolean };
    const record = await addLeadStageTransition(client, crmContext(session), body.fromStageId ?? "", body.toStageId ?? "", { reasonRequired: body.reasonRequired });
    return ok({ record }, 201);
  });
}
