import { setCampaignStatus } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Archive or restore a campaign ({ status: "active" | "archived" }); leads and deals that name it keep it.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session, snapshot }) => {
    const body = await readBody(request);
    return ok({ campaign: await setCampaignStatus(client, crmContext(session, snapshot), id, body.status === "active" ? "active" : "archived") });
  });
}
