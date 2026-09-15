import { assertSameOriginOrMobile, getAccountHierarchy, setAccountParent } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction, withClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F002 Tranche E (Stage A). getAccountHierarchy/setAccountParent
// (account-intelligence.js) were already a real, already-tested,
// already-cycle-guarded service — see crm-account-hierarchy-f002.test.mjs,
// which predates this pass. Never reachable from the frontend before this
// route: confirmed by grep that no apps/web file referenced either
// function. GET stays module-access-only (matches the Account GET
// convention); PATCH requires crm.accounts.manage (matches the Account
// PATCH/DELETE convention in accounts/[id]/route.ts).
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const hierarchy = await withClient(async (client) => {
      await requireCrmAccess(client, session);
      return getAccountHierarchy(client, crmContext(session), id);
    });
    return ok(hierarchy);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const body = (await readJson(request)) as { parentId?: string | null; reason?: string | null };
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.accountsManage);
      return setAccountParent(client, crmContext(session), id, body.parentId || null, body.reason || null);
    });
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}
