import { archiveLeadAssignmentPolicy, saveLeadAssignmentPolicy, setLeadAssignmentPolicyStatus } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await saveLeadAssignmentPolicy(client, crmContext(session), { ...input, id });
    return ok({ record });
  });
}

// Activate/deactivate share one governed transition; the request body
// picks which one, matching saveLeadAssignmentPolicy's own active/inactive
// vocabulary rather than inventing a second convention.
export async function POST(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const body = (await readJson(request)) as { status?: "active" | "inactive"; expectedUpdatedAt?: string };
    const record = await setLeadAssignmentPolicyStatus(client, crmContext(session), id, body.status === "active" ? "active" : "inactive", body.expectedUpdatedAt);
    return ok({ record });
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const url = new URL(request.url);
    const expectedUpdatedAt = url.searchParams.get("expectedUpdatedAt") ?? undefined;
    const record = await archiveLeadAssignmentPolicy(client, crmContext(session), id, expectedUpdatedAt);
    return ok({ record });
  });
}
