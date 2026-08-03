import { mergeAccountsGoverned } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import {
  requireBillingWriteAccess,
  incrementBillingUsage,
} from "@/lib/billing";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOriginOrMobile, audit } from "@/lib/security";

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
    const context = crmContext(session);
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
