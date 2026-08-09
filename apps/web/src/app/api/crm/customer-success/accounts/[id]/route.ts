import {
  createChurnIntervention,
  createCustomerSuccessPlan,
  getCustomerSuccessAccount,
  recalculateCustomerHealth,
  resolveChurnIntervention,
  updateCustomerSuccessMilestone,
  upsertRenewalCase,
} from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import {
  requireBillingWriteAccess,
  incrementBillingUsage,
} from "@/lib/billing";
import { crmApiContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok, readJson } from "@/lib/http";
import { crmCustomerSuccessErrorResponse } from "@/lib/crm-customer-success-route";
import { assertSameOriginOrMobile, audit } from "@/lib/security";

export async function GET(
  _request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const { id } = await route.params;
    const context = await crmApiContext(session);
    const customerSuccess = await tenantTransaction(
      context.organizationId,
      (client) => getCustomerSuccessAccount(client, context, id),
    );
    return ok({ customerSuccess });
  } catch (error) {
    return crmCustomerSuccessErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmAccountsManage);
    const body = (await readJson(request)) as Record<string, unknown>;
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const { id } = await route.params;
    const action = String(body.action || "");
    const context = await crmApiContext(session);
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        let value: Record<string, unknown>;
        if (action === "create_plan")
          value = await createCustomerSuccessPlan(client, context, id, body);
        else if (action === "update_milestone")
          value = await updateCustomerSuccessMilestone(
            client,
            context,
            String(body.milestoneId || ""),
            body,
          );
        else if (action === "upsert_renewal")
          value = await upsertRenewalCase(client, context, id, body);
        else if (action === "create_intervention")
          value = await createChurnIntervention(client, context, id, body);
        else if (action === "resolve_intervention")
          value = await resolveChurnIntervention(
            client,
            context,
            String(body.interventionId || ""),
            String(body.resolution || ""),
          );
        else if (action === "recalculate_health")
          value = await recalculateCustomerHealth(client, context, id);
        else throw new HttpError(400, "Unknown customer-success action.");
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: `crm.customer_success.${action}`,
          entityType: "account",
          entityId: id,
          afterData: value,
          request,
          client,
        });
        return value;
      },
    );
    return ok({ message: "Customer-success workflow updated.", result });
  } catch (error) {
    return crmCustomerSuccessErrorResponse(error);
  }
}
