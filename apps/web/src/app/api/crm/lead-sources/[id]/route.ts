import {
  getCrmLeadSource,
  setCrmLeadSourceActive,
  updateCrmLeadSource,
} from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/core/billing";
import {
  PERMISSIONS,
  requirePermissionFromSession,
} from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier, requireCrmView } from "@/modules/crm/crm-data-operations-and-customization/resource-access";

function sourceInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(
      400,
      "Provide a lead source object.",
      "CRM_LEAD_SOURCE_INPUT_INVALID",
    );
  return value as Record<string, unknown>;
}

async function writeContext(request: Request) {
  assertSameOrigin(request);
  const session = await getSessionContext();
  if (!session?.organizationId)
    throw new HttpError(401, "Sign in to an organisation workspace.");
  requireCrmView(session);
  requirePermissionFromSession(session, PERMISSIONS.crmSettingsManage);
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
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    requireCrmView(session);
    const context = await crmApiContext(session);
    const { id } = await route.params;
    assertCrmIdentifier(id);
    return ok({
      record: await tenantTransaction(context.organizationId, (client) =>
        getCrmLeadSource(client, context, id),
      ),
    });
  } catch (error) {
    return crmErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    const { context } = await writeContext(request);
    const { id } = await route.params;
    assertCrmIdentifier(id);
    const input = sourceInput(await readJson(request));
    const reactivate = input.action === "reactivate";
    if ("action" in input) delete input.action;
    // Concurrency (Prompts 1-5 integrity closeout): matches the Account/
    // Contact checked-write contract exactly — a stale administrator must
    // receive a typed 409 conflict, never silently overwrite a newer edit.
    const expectedUpdatedAt = String(input.expectedUpdatedAt || "").trim();
    if (!expectedUpdatedAt)
      throw new HttpError(
        400,
        "Refresh this Lead source before changing it.",
        "CRM_LEAD_SOURCE_VERSION_REQUIRED",
      );
    delete input.expectedUpdatedAt;
    const record = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const before = await getCrmLeadSource(client, context, id);
        const updated = reactivate
          ? await setCrmLeadSourceActive(client, context, id, true, { expectedUpdatedAt, requireVersion: true })
          : await updateCrmLeadSource(client, context, id, input, { expectedUpdatedAt, requireVersion: true });
        await audit({
          organizationId: context.organizationId,
          actorUserId: context.userId,
          eventType: reactivate
            ? "crm.lead_sources.reactivated"
            : "crm.lead_sources.updated",
          entityType: "lead_source",
          entityId: id,
          beforeData: { name: before.name, status: before.status },
          afterData: { name: updated.name, status: updated.status },
          request,
          client,
        });
        return updated;
      },
    );
    return ok({
      message: reactivate ? "Lead source reactivated." : "Lead source updated.",
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
    const { context } = await writeContext(request);
    const { id } = await route.params;
    assertCrmIdentifier(id);
    const expectedUpdatedAt = String(
      new URL(request.url).searchParams.get("expectedUpdatedAt") || "",
    ).trim();
    if (!expectedUpdatedAt)
      throw new HttpError(
        400,
        "Refresh this Lead source before deactivating it.",
        "CRM_LEAD_SOURCE_VERSION_REQUIRED",
      );
    const record = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const before = await getCrmLeadSource(client, context, id);
        const updated = await setCrmLeadSourceActive(
          client,
          context,
          id,
          false,
          { expectedUpdatedAt, requireVersion: true },
        );
        await audit({
          organizationId: context.organizationId,
          actorUserId: context.userId,
          eventType: "crm.lead_sources.deactivated",
          entityType: "lead_source",
          entityId: id,
          beforeData: {
            name: before.name,
            status: before.status,
            leadCount: before.leadCount,
          },
          afterData: {
            name: updated.name,
            status: updated.status,
            leadCount: updated.leadCount,
          },
          request,
          client,
        });
        return updated;
      },
    );
    return ok({
      message: "Lead source deactivated. Existing Leads keep this source.",
      record,
    });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
