import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/lib/billing";
import { convertCrmLead } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { assertCrmIdentifier } from "@/lib/crm-api";
import { crmContext, rethrowCrmError } from "@/lib/crm";
import { convertLeadSchema } from "@/lib/crm-validation";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
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
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsManage);
    await requireBillingWriteAccess(session.organizationId);
    const { id } = await route.params;
    assertCrmIdentifier(id);
    const input = convertLeadSchema.parse(await readJson(request));
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = crmContext(session);
    const conversion = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const converted = await convertCrmLead(client, context, id, input);
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: "crm.lead.converted",
          entityType: "lead",
          entityId: id,
          afterData: converted,
          request,
          client,
        });
        return converted;
      },
    );
    return ok({
      message: conversion.replayed
        ? "Lead was already converted."
        : "Lead converted to customer and opportunity.",
      conversion,
    });
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
