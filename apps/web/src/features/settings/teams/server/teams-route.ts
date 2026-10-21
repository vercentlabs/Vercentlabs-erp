import "server-only";

import { requireSessionPermission } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { workspaceRoute } from "@/core/workspace-route";
import type { WorkspaceSessionContext } from "@/core/session";
import { crmContext } from "@/features/crm/shared/crm-context";

// Teams (Settings › Teams) belong to the workspace, not to CRM alone: Sales' team visibility ("Team orders", team customers) reads them,
// so a company with Sales but not CRM sets them up too (Sales audit B10). Seeing them needs CRM or Sales; changing them needs CRM's
// "manage teams" or Sales' "manage settings".
const can = (session: WorkspaceSessionContext, key: string) => {
  try {
    requireSessionPermission(session, key);
    return true;
  } catch {
    return false;
  }
};

type Run = (args: { client: Parameters<Parameters<typeof workspaceRoute>[2]>[0]["client"]; context: ReturnType<typeof crmContext> }) => Promise<Response>;

export function teamsRoute(request: Request, { manage = false }: { manage?: boolean }, run: Run) {
  return workspaceRoute(request, manage ? { billingWrite: true } : {}, async ({ client, session, snapshot }) => {
    const allowed = manage
      ? can(session, CRM_PERMISSIONS.teamsManage) || can(session, "sales.settings.manage")
      : can(session, CRM_PERMISSIONS.view) || can(session, "sales.view");
    if (!allowed) requireSessionPermission(session, manage ? CRM_PERMISSIONS.teamsManage : CRM_PERMISSIONS.view);
    return run({ client, context: crmContext(session, snapshot) });
  });
}
