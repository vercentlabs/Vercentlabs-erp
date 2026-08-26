import {
  archiveCrmAccount,
  getCrmAccount,
  updateCrmAccount,
} from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/core/billing";
import {
  requirePermissionFromSession,
  PERMISSIONS,
} from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier, requireCrmView } from "@/modules/crm/api";

type RouteContext = { params: Promise<{ id: string }> };

function accountInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(
      400,
      "Provide an account object.",
      "CRM_ACCOUNT_INPUT_INVALID",
    );
  }
  return value as Record<string, unknown>;
}

function auditSnapshot(record: Record<string, unknown>) {
  return {
    id: record.id,
    code: record.code,
    displayName: record.displayName,
    partyType: record.partyType,
    companyId: record.companyId,
    status: record.status,
  };
}

export async function GET(_request: Request, routeContext: RouteContext) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) {
      throw new HttpError(401, "Sign in to an organisation workspace.");
    }
    requireCrmView(session);
    const { id } = await routeContext.params;
    assertCrmIdentifier(id);
    const context = await crmApiContext(session);
    const record = await tenantTransaction(context.organizationId, (client) =>
      getCrmAccount(client, context, id),
    );
    return ok({ record });
  } catch (error) {
    return crmErrorResponse(error);
  }
}

export async function PATCH(request: Request, routeContext: RouteContext) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) {
      throw new HttpError(401, "Sign in to an organisation workspace.");
    }
    requireCrmView(session);
    requirePermissionFromSession(session, PERMISSIONS.partiesManage);
    await requireBillingWriteAccess(session.organizationId);
    const { id } = await routeContext.params;
    assertCrmIdentifier(id);
    const context = await crmApiContext(session);
    const input = accountInput(await readJson(request));
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");

    const record = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const before = await getCrmAccount(client, context, id);
        const updated = await updateCrmAccount(client, context, id, input);
        await audit({
          organizationId: context.organizationId,
          actorUserId: context.userId,
          eventType: "crm.accounts.updated",
          entityType: "account",
          entityId: id,
          beforeData: auditSnapshot(before),
          afterData: {
            ...auditSnapshot(updated),
            changedFields: Object.keys(input),
          },
          request,
          client,
        });
        return updated;
      },
    );
    return ok({ message: "Account updated.", record });
  } catch (error) {
    return crmErrorResponse(error);
  }
}

export async function DELETE(request: Request, routeContext: RouteContext) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) {
      throw new HttpError(401, "Sign in to an organisation workspace.");
    }
    requireCrmView(session);
    requirePermissionFromSession(session, PERMISSIONS.partiesManage);
    await requireBillingWriteAccess(session.organizationId);
    const { id } = await routeContext.params;
    assertCrmIdentifier(id);
    const context = await crmApiContext(session);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");

    const record = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const before = await getCrmAccount(client, context, id);
        const archived = await archiveCrmAccount(client, context, id);
        await audit({
          organizationId: context.organizationId,
          actorUserId: context.userId,
          eventType: "crm.accounts.archived",
          entityType: "account",
          entityId: id,
          beforeData: auditSnapshot(before),
          afterData: auditSnapshot(archived),
          request,
          client,
        });
        return archived;
      },
    );
    return ok({ message: "Account archived.", record });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
