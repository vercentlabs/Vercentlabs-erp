import {
  archiveLeadAssignmentPolicy,
  clearLeadAssigneeAvailability,
  getLeadAssignmentFallback,
  listLeadAssigneeAvailability,
  listLeadAssignmentPolicies,
  saveLeadAssignmentPolicy,
  setLeadAssigneeAvailability,
  setLeadAssignmentFallback,
  setLeadAssignmentPolicyStatus,
} from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import {
  PERMISSIONS,
  requirePermissionFromSession,
} from "@/core/authorization";
import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/core/billing";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";

export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmSettingsManage);
    const context = await crmApiContext(session);
    // Sequential, not Promise.all — see the CRM revenue-intelligence fix for
    // why concurrent client.query() on one shared PoolClient is unsafe.
    const [policies, fallback, availability] = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const policiesResult = await listLeadAssignmentPolicies(client, context);
        const fallbackResult = await getLeadAssignmentFallback(client, context);
        const availabilityResult = await listLeadAssigneeAvailability(client, context);
        return [policiesResult, fallbackResult, availabilityResult] as const;
      },
    );
    // F005 Prompt 4: territory/workload modes are now governed CRM-CAP-002
    // configuration (previously write-blocked and hidden here) — every
    // active mode is returned.
    return ok({ policies, fallback, availability });
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmSettingsManage);
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const input = (await readJson(request)) as Record<string, unknown>;
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const action = String(input.action || "save");
        if (action === "set-fallback") {
          const changed = await setLeadAssignmentFallback(
            client,
            context,
            input.fallbackUserId ? String(input.fallbackUserId) : null,
          );
          await audit({
            organizationId: context.organizationId,
            actorUserId: session.userId,
            eventType: "crm.lead_assignment_fallback.updated",
            entityType: "crm.lead_assignment_fallback",
            entityId: context.organizationId,
            afterData: { fallbackUserId: changed.fallback_user_id },
            request,
            client,
          });
          return changed;
        }
        if (action === "set-availability") {
          const changed = await setLeadAssigneeAvailability(client, context, input);
          await audit({
            organizationId: context.organizationId,
            actorUserId: session.userId,
            eventType: "crm.lead_assignee_availability.created",
            entityType: "crm.lead_assignee_availability",
            entityId: String(changed.id),
            afterData: { userId: changed.user_id, startsAt: changed.starts_at, endsAt: changed.ends_at },
            request,
            client,
          });
          return changed;
        }
        if (action === "clear-availability") {
          const changed = await clearLeadAssigneeAvailability(
            client,
            context,
            String(input.availabilityId || ""),
          );
          await audit({
            organizationId: context.organizationId,
            actorUserId: session.userId,
            eventType: "crm.lead_assignee_availability.cleared",
            entityType: "crm.lead_assignee_availability",
            entityId: String(changed.id),
            request,
            client,
          });
          return changed;
        }
        const changed =
          action === "archive"
            ? await archiveLeadAssignmentPolicy(
                client,
                context,
                String(input.policyId || ""),
              )
            : action === "activate"
              ? await setLeadAssignmentPolicyStatus(
                  client,
                  context,
                  String(input.policyId || ""),
                  "active",
                )
              : await saveLeadAssignmentPolicy(client, context, input);
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType:
            action === "archive"
              ? "crm.lead_assignment_rule.deactivated"
              : action === "activate"
                ? "crm.lead_assignment_rule.activated"
                : input.id
                  ? "crm.lead_assignment_rule.updated"
                  : "crm.lead_assignment_rule.created",
          entityType: "crm.lead_assignment_rule",
          entityId: String(changed.id),
          afterData: {
            id: changed.id,
            name: changed.name,
            sequence: changed.sequence,
            mode: changed.mode,
            status: changed.status,
          },
          request,
          client,
        });
        return changed;
      },
    );
    return ok({ result }, input.id || input.action ? 200 : 201);
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
