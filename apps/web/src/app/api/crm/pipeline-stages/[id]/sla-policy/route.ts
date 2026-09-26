import { upsertStageSlaPolicy } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const body = (await readJson(request)) as {
      pipelineId: string;
      maximumDays?: number | string | null;
      status?: "active" | "inactive";
      expectedUpdatedAt?: string;
    };
    const record = await upsertStageSlaPolicy(client, crmContext(session), { ...body, stageId: id });
    return ok({ record });
  });
}
