import { archiveLeadAssignmentPolicy, assertSameOriginOrMobile, saveLeadAssignmentPolicy, setLeadAssignmentPolicyStatus } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.settingsManage);
      return saveLeadAssignmentPolicy(client, crmContext(session), { ...input, id });
    });
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}

// Activate/deactivate share one governed transition; the request body
// picks which one, matching saveLeadAssignmentPolicy's own active/inactive
// vocabulary rather than inventing a second convention.
export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const body = (await readJson(request)) as { status?: "active" | "inactive"; expectedUpdatedAt?: string };
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.settingsManage);
      return setLeadAssignmentPolicyStatus(client, crmContext(session), id, body.status === "active" ? "active" : "inactive", body.expectedUpdatedAt);
    });
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const url = new URL(request.url);
    const expectedUpdatedAt = url.searchParams.get("expectedUpdatedAt") ?? undefined;
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.settingsManage);
      return archiveLeadAssignmentPolicy(client, crmContext(session), id, expectedUpdatedAt);
    });
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}
