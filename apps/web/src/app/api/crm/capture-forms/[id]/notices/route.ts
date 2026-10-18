import { listCaptureNotices } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// Every version of the form's consent notice, newest first, with how many leads agreed to each.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.captureManage }, async ({ client, session, snapshot }) =>
    ok({ notices: await listCaptureNotices(client, crmContext(session, snapshot), id) }));
}
