import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/core/billing";
import {
  archiveCrmRecord,
  assignLeadOwner,
  getCrmRecord,
  updateCrmRecord,
} from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import {
  assertCrmIdentifier,
  requireCrmManage,
  requireCrmResourceView,
} from "@/modules/crm/api";
import {
  crmApiContext,
  crmDefinitions,
  crmErrorResponse,
  isCrmDefinition,
} from "@/modules/crm";
import { isCrmApiResource } from "@/modules/crm/scope";
import { crmPatchSchemas } from "@/modules/crm/validation";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmAuditSnapshot } from "@/modules/crm/audit";

export async function GET(
  _request: Request,
  route: { params: Promise<{ resource: string; id: string }> },
) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    const { resource, id } = await route.params;
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
    assertCrmIdentifier(id);
    requireCrmResourceView(session, resource);
    const context = await crmApiContext(session);
    const record = await tenantTransaction(context.organizationId, (client) =>
      getCrmRecord(client, context, resource, id),
    );
    return ok({ record });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
export async function PATCH(
  request: Request,
  route: { params: Promise<{ resource: string; id: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    const { resource, id } = await route.params;
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
    assertCrmIdentifier(id);
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
        "Use the governed Lead lifecycle transition action.",
        "CRM_LEAD_STAGE_ACTION_REQUIRED",
      );
    const input = await crmPatchSchemas[resource].parseAsync(rawInput);
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
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        if (
          resource === "leads" &&
          Object.prototype.hasOwnProperty.call(input, "ownerUserId")
        ) {
          if (Object.keys(input).length !== 1)
            throw new HttpError(
              409,
              "Change the Lead owner separately from other Lead fields.",
              "CRM_LEAD_ASSIGNMENT_REQUIRED",
            );
          const assigned = await assignLeadOwner(
            client,
            context,
            id,
            input.ownerUserId ? String(input.ownerUserId) : null,
            { reason: "manual:patch" },
          );
          if (assigned.assignment.changed)
            await audit({
              organizationId: context.organizationId,
              actorUserId: session.userId,
              eventType: "crm.leads.assigned",
              entityType: "leads",
              entityId: id,
              beforeData: {
                ownerUserId: assigned.assignment.previousOwnerUserId,
              },
              afterData: { ownerUserId: assigned.assignment.ownerUserId },
              metadata: { assignmentEventId: assigned.assignment.eventId },
              request,
              client,
            });
          return { record: assigned.lead, assignment: assigned.assignment };
        }
        const updated = await updateCrmRecord(
          client,
          context,
          resource,
          id,
          input,
        );
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: `crm.${resource}.updated`,
          entityType: resource,
          entityId: id,
          afterData: crmAuditSnapshot(resource, updated, Object.keys(input).filter((field) => field !== "duplicateOverrideReason")),
          request,
          client,
        });
        return { record: updated, assignment: null };
      },
    );
    return ok({
      message:
        result.assignment && !result.assignment.changed
          ? "Lead owner was already selected."
          : `${crmDefinitions[resource].singular.replace(/^./, (c) => c.toUpperCase())} updated.`,
      record: result.record,
      assignment: result.assignment,
    });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
export async function DELETE(
  request: Request,
  route: { params: Promise<{ resource: string; id: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    const { resource, id } = await route.params;
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
    assertCrmIdentifier(id);
    requireCrmManage(session, resource);
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const record = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const archived = await archiveCrmRecord(client, context, resource, id);
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: `crm.${resource}.archived`,
          entityType: resource,
          entityId: id,
          afterData: crmAuditSnapshot(resource, archived),
          request,
          client,
        });
        return archived;
      },
    );
    return ok({
      message: `${crmDefinitions[resource].singular.replace(/^./, (c) => c.toUpperCase())} archived.`,
      record,
    });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
