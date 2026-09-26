import { getAccountHierarchy, setAccountParent } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F002 Tranche E (Stage A). getAccountHierarchy/setAccountParent
// (account-intelligence.js) were already a real, already-tested,
// already-cycle-guarded service — see crm-account-hierarchy-f002.test.mjs,
// which predates this pass. Never reachable from the frontend before this
// route: confirmed by grep that no apps/web file referenced either
// function. GET stays module-access-only (matches the Account GET
// convention); PATCH requires crm.accounts.manage (matches the Account
// PATCH/DELETE convention in accounts/[id]/route.ts).
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const { id } = await context.params;
    const hierarchy = await getAccountHierarchy(client, crmContext(session), id);
    return ok(hierarchy);
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsManage, billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const body = (await readJson(request)) as { parentId?: string | null; reason?: string | null };
    const record = await setAccountParent(client, crmContext(session), id, body.parentId || null, body.reason || null);
    return ok({ record });
  });
}
