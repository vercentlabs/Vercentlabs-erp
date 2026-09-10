import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/core/billing";
import { convertCrmLead } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { assertCrmIdentifier } from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { convertLeadSchema } from "@/modules/crm/crm-data-operations-and-customization/input-validation";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOriginOrMobile, audit } from "@/core/security";
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
    const context = await crmApiContext(session);
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
        : conversion.opportunityId
          ? "Lead converted to customer and opportunity."
          : "Lead converted to customer.",
      conversion,
    });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
