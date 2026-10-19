import { getCompanyProfile, getSetupProgress, getWorkspaceClosure, listWorkspaceExports, updateCompanyProfile } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Settings > Company (Shared Platform plan 3): the company profile printed on documents, the setup progress, exports and closure.
export async function GET(request: Request) {
  return workspaceRoute(request, { action: "organization.company.view" }, async ({ client, session }) => {
    const manager = session.roleSlugs.includes("organization_owner") || session.roleSlugs.includes("system_administrator");
    return ok({
      profile: await getCompanyProfile(client, session.organizationId),
      setup: await getSetupProgress(client, session.organizationId),
      closure: await getWorkspaceClosure(client, session.organizationId),
      exports: manager ? await listWorkspaceExports(client, session.organizationId) : [],
    });
  });
}

export async function PUT(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.organizationManage, action: "organization.company.update", auditDenial: true },
    async ({ client, session }) => ok({ profile: await updateCompanyProfile(client, session, (await readJson(request)) as Record<string, unknown>) }),
  );
}
