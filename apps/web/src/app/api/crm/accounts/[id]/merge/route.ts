import { mergeAccountsGoverned } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import {
  requireBillingWriteAccess,
  incrementBillingUsage,
} from "@/core/billing";
import { crmApiContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOriginOrMobile, audit } from "@/core/security";

export async function POST(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmAccountsManage);
    await requireBillingWriteAccess(session.organizationId);
    const { id } = await route.params;
    const body = (await readJson(request)) as {
      survivorId?: string;
      reason?: string;
    };
    if (!body.survivorId)
      throw new HttpError(400, "Choose the surviving record.");
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const merge = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const result = await mergeAccountsGoverned(
          client,
          context,
          id,
          body.survivorId!,
          body.reason || null,
        );
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: "crm.account.merged",
          entityType: "account",
          entityId: body.survivorId!,
          afterData: result,
          request,
          client,
        });
        return result;
      },
    );
    return ok({ message: "Records merged successfully.", merge });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) {
      const message =
        "message" in error ? String(error.message) : "CRM request failed.";
      return errorResponse(new HttpError(Number(error.status), message));
    }
    return errorResponse(error);
  }
}
