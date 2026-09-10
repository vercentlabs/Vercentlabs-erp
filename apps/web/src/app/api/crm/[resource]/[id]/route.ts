import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/core/billing";
import {
  archiveCrmRecord,
  assignLeadOwner,
  cancelCrmTask,
  getCrmRecord,
  startCrmTask,
  updateCrmRecord,
  updateCrmTask,
} from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import {
  assertCrmIdentifier,
  requireCrmManage,
  requireCrmResourceView,
} from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import {
  crmApiContext,
  crmDefinitions,
  crmErrorResponse,
  isCrmDefinition,
} from "@/modules/crm";
import { isCrmApiResource } from "@/modules/crm/crm-data-operations-and-customization/capability-registry";
import { crmPatchSchemas } from "@/modules/crm/crm-data-operations-and-customization/input-validation";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmAuditSnapshot } from "@/modules/crm/crm-data-operations-and-customization/audit-events";

// Concurrency (Prompts 1-5 integrity closeout): mutable generic-CRUD
// configuration resources with no existing append-only/versioned model
// (qualification-criteria — no archive/DELETE transition is defined for it
// server-side, so it is PATCH-only here — and lost-reasons, which supports
// both) now share the exact Lead/Opportunity checked-write contract rather
// than getting a fourth near-identical implementation.
const VERSIONED_PATCH_LABELS: Record<string, string> = {
  leads: "Lead",
  opportunities: "Opportunity",
  "qualification-criteria": "Qualification criterion",
  "lost-reasons": "Won/Lost reason",
};
const VERSIONED_DELETE_LABELS: Record<string, string> = {
  leads: "Lead",
  opportunities: "Opportunity",
  "lost-reasons": "Won/Lost reason",
};
// Explicit, not derived from the resource key: "leads"/"opportunities" must
// keep producing the exact CRM_LEAD_VERSION_REQUIRED/CRM_OPPORTUNITY_
// VERSION_REQUIRED codes the API layer's own assertRecordExpectedVersion
// already throws for the same condition (singular entity, not the plural
// resource key uppercased) — this is this route's own pre-check for the
// same error, so its code must match, not merely resemble it.
const VERSION_CODE_PREFIXES: Record<string, string> = {
  leads: "CRM_LEAD",
  opportunities: "CRM_OPPORTUNITY",
  "qualification-criteria": "CRM_QUALIFICATION_CRITERIA",
  "lost-reasons": "CRM_LOST_REASON",
};
function versionCode(resource: string) {
  return `${VERSION_CODE_PREFIXES[resource]}_VERSION_REQUIRED`;
}

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
    if (resource === "stages")
      throw new HttpError(
        410,
        "Use the governed Sales Stages API.",
        "CRM_SALES_STAGE_API_MOVED",
      );
    assertCrmIdentifier(id);
    requireCrmManage(session, resource);
    await requireBillingWriteAccess(session.organizationId);
    const rawInput = (await readJson(request)) as Record<string, unknown>;
    // Integrity closeout (Prompts 1-5): ordinary Opportunity edits through
    // this generic route never required expectedUpdatedAt at all — only
    // Leads did — so two concurrent editors of the same Opportunity's
    // amount/close date/etc. could silently overwrite each other, unlike
    // the dedicated stage/probability commands.
    const versionedResource = Object.prototype.hasOwnProperty.call(VERSIONED_PATCH_LABELS, resource);
    const expectedUpdatedAt = versionedResource
      ? String(rawInput.expectedUpdatedAt || "").trim()
      : "";
    if (versionedResource) {
      if (!expectedUpdatedAt)
        throw new HttpError(
          400,
          `Refresh this ${VERSIONED_PATCH_LABELS[resource]} before changing it.`,
          versionCode(resource),
        );
      delete rawInput.expectedUpdatedAt;
    }
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
            {
              reason: "manual:patch",
              expectedUpdatedAt,
              requireVersion: true,
            },
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
        const before = await getCrmRecord(client, context, resource, id);
        let updated;
        if (resource === "activities") {
          const current = before;
          if (String(current.activityType || "").toLowerCase() === "task") {
            const taskInput = { ...input };
            const requestedType = String(taskInput.activityType || "task").toLowerCase();
            if (requestedType !== "task")
              throw new HttpError(409, "A Task cannot be changed into another activity type.", "CRM_TASK_TYPE_IMMUTABLE");
            delete taskInput.activityType;
            const requestedStatus = taskInput.status == null ? null : String(taskInput.status).toLowerCase();
            delete taskInput.status;
            if (requestedStatus && requestedStatus !== current.status) {
              if (Object.keys(taskInput).length)
                throw new HttpError(409, "Change Task status separately from other Task fields.", "CRM_TASK_STATUS_ACTION_REQUIRED");
              if (requestedStatus === "in_progress") updated = await startCrmTask(client, context, id);
              else if (requestedStatus === "cancelled") updated = await cancelCrmTask(client, context, id);
              else if (requestedStatus === "completed")
                throw new HttpError(409, "Use the governed Task completion action.", "CRM_TASK_COMPLETION_REQUIRED");
              else throw new HttpError(409, "Use a governed Task lifecycle action for this status.", "CRM_TASK_STATUS_ACTION_REQUIRED");
            } else {
              updated = await updateCrmTask(client, context, id, taskInput);
            }
          } else {
            updated = await updateCrmRecord(client, context, resource, id, input);
          }
        } else {
          updated = await updateCrmRecord(
            client,
            context,
            resource,
            id,
            input,
            versionedResource
              ? { expectedUpdatedAt, requireVersion: true }
              : undefined,
          );
        }
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: `crm.${resource}.updated`,
          entityType: resource,
          entityId: id,
          beforeData: crmAuditSnapshot(resource, before),
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
    if (resource === "stages")
      throw new HttpError(
        410,
        "Use the governed Sales Stages API.",
        "CRM_SALES_STAGE_API_MOVED",
      );
    assertCrmIdentifier(id);
    requireCrmManage(session, resource);
    const versionedResource = Object.prototype.hasOwnProperty.call(VERSIONED_DELETE_LABELS, resource);
    const expectedUpdatedAt = versionedResource
      ? String(new URL(request.url).searchParams.get("expectedUpdatedAt") || "").trim()
      : "";
    if (versionedResource && !expectedUpdatedAt)
      throw new HttpError(
        400,
        `Refresh this ${VERSIONED_DELETE_LABELS[resource]} before archiving it.`,
        versionCode(resource),
      );
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const record = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const before = resource === "activities" ? await getCrmRecord(client, context, resource, id) : null;
        const archived = before && String(before.activityType || "").toLowerCase() === "task"
          ? await cancelCrmTask(client, context, id)
          : await archiveCrmRecord(
              client,
              context,
              resource,
              id,
              versionedResource
                ? { expectedUpdatedAt, requireVersion: true }
                : undefined,
            );
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
