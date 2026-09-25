import { listModuleAdministration } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// All business modules with tenant enablement and plan entitlement reported
// separately — enabling a module never changes billing and vice versa.
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.modulesManage, action: "settings.modules.list", transaction: "none" },
    async ({ client, session }) => ok({ modules: await listModuleAdministration(client, session, process.env) }),
  );
}
