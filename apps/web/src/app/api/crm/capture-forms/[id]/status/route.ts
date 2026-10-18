import { setCaptureFormStatus } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Switch a form on or off ({ status: "active" | "inactive" }); switched off, its page and embeds stop taking submissions.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.captureManage, billingWrite: true }, async ({ client, session, snapshot }) => {
    const body = await readBody(request);
    return ok({ form: await setCaptureFormStatus(client, crmContext(session, snapshot), id, body.status === "active" ? "active" : "inactive") });
  });
}
