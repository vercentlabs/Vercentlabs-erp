import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/core/billing";
import { createCrmRecord, listCrmRecords } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requireCrmManage, requireCrmResourceView } from "@/modules/crm/api";
import {
  crmApiContext,
  crmDefinitions,
  crmErrorResponse,
  isCrmDefinition,
} from "@/modules/crm";
import { isCrmApiResource } from "@/modules/crm/scope";
import { crmSchemas } from "@/modules/crm/validation";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmAuditSnapshot } from "@/modules/crm/audit";

export async function GET(
  request: Request,
  route: { params: Promise<{ resource: string }> },
) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    const { resource } = await route.params;
    if (!isCrmDefinition(resource) || !isCrmApiResource(resource))
      throw new HttpError(404, "Unknown CRM resource.");
    if (resource === "assignment-rules")
      throw new HttpError(
        410,
        "Use the governed Lead Assignment Rules API.",
        "CRM_ASSIGNMENT_RULE_API_MOVED",
      );
    requireCrmResourceView(session, resource);
    const url = new URL(request.url);
    const context = await crmApiContext(session);
    const result = await tenantTransaction(context.organizationId, (client) =>
      listCrmRecords(
        client,
        context,
        resource,
        Object.fromEntries(url.searchParams.entries()),
      ),
    );
    return ok(result);
  } catch (error) {
    return crmErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  route: { params: Promise<{ resource: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    const { resource } = await route.params;
    if (!isCrmDefinition(resource) || !isCrmApiResource(resource))
      throw new HttpError(404, "Unknown CRM resource.");
    if (resource === "assignment-rules")
      throw new HttpError(
        410,
        "Use the governed Lead Assignment Rules API.",
        "CRM_ASSIGNMENT_RULE_API_MOVED",
      );
    if (resource === "sources")
      throw new HttpError(
        410,
        "Use the governed Lead Sources API.",
        "CRM_LEAD_SOURCE_API_MOVED",
      );
    if (resource === "stages")
      throw new HttpError(
        410,
        "Use the governed Sales Stages API.",
        "CRM_SALES_STAGE_API_MOVED",
      );
    requireCrmManage(session, resource);
    await requireBillingWriteAccess(session.organizationId);
    const rawInput = (await readJson(request)) as Record<string, unknown>;
    if (
      resource === "leads" &&
      ["status", "stage", "stageId", "stageCode", "recordStatus"].some(
        (field) => Object.prototype.hasOwnProperty.call(rawInput, field),
      )
    )
      throw new HttpError(
        409,
        "New Leads always begin in the configured initial lifecycle stage.",
        "CRM_LEAD_INITIAL_STAGE_GOVERNED",
      );
    const input = await crmSchemas[resource].parseAsync(rawInput);
    if (
      resource === "leads" &&
      Object.prototype.hasOwnProperty.call(rawInput, "duplicateOverrideReason")
    ) {
      const reason = String(rawInput.duplicateOverrideReason || "").trim();
      if (reason.length > 1000)
        throw new HttpError(
          400,
          "Duplicate override reason must be at most 1,000 characters.",
          "CRM_LEAD_DUPLICATE_OVERRIDE_REASON_REQUIRED",
        );
      input.duplicateOverrideReason = reason;
    }
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const record = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const created = await createCrmRecord(client, context, resource, input);
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: `crm.${resource}.created`,
          entityType: resource,
          entityId: String(created.id),
          afterData: crmAuditSnapshot(resource, created, Object.keys(input).filter((field) => field !== "duplicateOverrideReason")),
          request,
          client,
        });
        return created;
      },
    );
    return ok(
      {
        message: `${crmDefinitions[resource].singular.replace(/^./, (c) => c.toUpperCase())} created.`,
        record,
      },
      201,
    );
  } catch (error) {
    return crmErrorResponse(error);
  }
}
