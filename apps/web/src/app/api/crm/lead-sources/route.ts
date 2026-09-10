import { createCrmLeadSource, listCrmLeadSources } from "@vercentlabs/api";

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
import { requireCrmView } from "@/modules/crm/crm-data-operations-and-customization/resource-access";

function sourceInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(
      400,
      "Provide a lead source object.",
      "CRM_LEAD_SOURCE_INPUT_INVALID",
    );
  return value as Record<string, unknown>;
}

export async function GET(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    requireCrmView(session);
    const context = await crmApiContext(session);
    const url = new URL(request.url);
    const requested = url.searchParams.get("status") || "active";
    const status = ["active", "inactive", "all"].includes(requested)
      ? requested
      : "active";
    const result = await tenantTransaction(context.organizationId, (client) =>
      listCrmLeadSources(client, context, {
        search: url.searchParams.get("search") || "",
        status,
        limit: Number(url.searchParams.get("limit") || 25),
        offset: Number(url.searchParams.get("offset") || 0),
      }),
    );
    return ok(result);
  } catch (error) {
    return crmErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    requireCrmView(session);
    requirePermissionFromSession(session, PERMISSIONS.crmSettingsManage);
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const input = sourceInput(await readJson(request));
    const record = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const created = await createCrmLeadSource(client, context, input);
        await audit({
          organizationId: context.organizationId,
          actorUserId: context.userId,
          eventType: "crm.lead_sources.created",
          entityType: "lead_source",
          entityId: String(created.id),
          afterData: {
            id: created.id,
            name: created.name,
            code: created.code,
            status: created.status,
          },
          request,
          client,
        });
        return created;
      },
    );
    return ok({ message: "Lead source created.", record }, 201);
  } catch (error) {
    return crmErrorResponse(error);
  }
}
