import { mergeTag } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

type Params = { params: Promise<{ id: string }> };

// Merge this tag into another ({ into }): its records get the other tag, and this one is deleted.
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session, snapshot }) => {
    const body = await readBody(request);
    return ok({ tag: await mergeTag(client, crmContext(session, snapshot), id, String(body.into ?? "")) });
  });
}
