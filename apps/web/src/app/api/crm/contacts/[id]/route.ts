import {
  archiveCrmContact,
  getCrmContact,
  getCrmContactForCaller,
  reactivateCrmContact,
  updateCrmContact,
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
import { requireCrmView } from "@/modules/crm/crm-data-operations-and-customization/resource-access";

function contactInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(
      400,
      "Provide a contact object.",
      "CRM_CONTACT_INPUT_INVALID",
    );
  }
  return value as Record<string, unknown>;
}

function auditSnapshot(record: Record<string, unknown>) {
  return {
    id: record.id,
    accountId: record.accountId,
    status: record.status,
    isPrimary: record.isPrimary,
  };
}

async function contextForWrite(request: Request) {
  assertSameOrigin(request);
  const session = await getSessionContext();
  if (!session?.organizationId) {
    throw new HttpError(401, "Sign in to an organisation workspace.");
  }
  requireCrmView(session);
  requirePermissionFromSession(session, PERMISSIONS.partiesManage);
  await requireBillingWriteAccess(session.organizationId);
  await incrementBillingUsage(session.organizationId, "api_requests_monthly");
  return { session, context: await crmApiContext(session) };
}

export async function GET(
  _request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) {
      throw new HttpError(401, "Sign in to an organisation workspace.");
    }
    requireCrmView(session);
    const context = await crmApiContext(session);
    const { id } = await route.params;
    const record = await tenantTransaction(context.organizationId, (client) =>
      getCrmContactForCaller(client, context, id),
    );
    return ok({ record });
  } catch (error) {
    return crmErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    const { context } = await contextForWrite(request);
    const { id } = await route.params;
    const input = contactInput(await readJson(request));
    const reactivate = input.action === "reactivate";
    if ("action" in input) delete input.action;
    const expectedUpdatedAt = String(input.expectedUpdatedAt || "").trim();
    if (!expectedUpdatedAt)
      throw new HttpError(
        400,
        "Refresh this Contact before changing it.",
        "CRM_CONTACT_VERSION_REQUIRED",
      );
    delete input.expectedUpdatedAt;
    const record = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const before = await getCrmContact(client, context, id);
        const updated = reactivate
          ? await reactivateCrmContact(client, context, id, { expectedUpdatedAt, requireVersion: true })
          : await updateCrmContact(client, context, id, input, { expectedUpdatedAt, requireVersion: true });
        if (!reactivate || before.status !== "active") {
          await audit({
            organizationId: context.organizationId,
            actorUserId: context.userId,
            eventType: reactivate ? "crm.contacts.reactivated" : "crm.contacts.updated",
            entityType: "contact",
            entityId: id,
            beforeData: auditSnapshot(before),
            afterData: reactivate
              ? auditSnapshot(updated)
              : { ...auditSnapshot(updated), changedFields: Object.keys(input) },
            request,
            client,
          });
        }
        return updated;
      },
    );
    return ok({
      message: reactivate ? "Contact reactivated." : "Contact updated.",
      record,
    });
  } catch (error) {
    return crmErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    const { context } = await contextForWrite(request);
    const { id } = await route.params;
    const expectedUpdatedAt = String(
      new URL(request.url).searchParams.get("expectedUpdatedAt") || "",
    ).trim();
    if (!expectedUpdatedAt)
      throw new HttpError(
        400,
        "Refresh this Contact before archiving it.",
        "CRM_CONTACT_VERSION_REQUIRED",
      );
    const record = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const before = await getCrmContact(client, context, id);
        const archived = await archiveCrmContact(client, context, id, {
          expectedUpdatedAt,
          requireVersion: true,
        });
        if (before.status !== "inactive") {
          await audit({
            organizationId: context.organizationId,
            actorUserId: context.userId,
            eventType: "crm.contacts.archived",
            entityType: "contact",
            entityId: id,
            beforeData: auditSnapshot(before),
            afterData: auditSnapshot(archived),
            request,
            client,
          });
        }
        return archived;
      },
    );
    return ok({ message: "Contact archived.", record });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
