import {
  archiveLeadAssignmentPolicy,
  listLeadAssignmentPolicies,
  saveLeadAssignmentPolicy,
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
    const policies = await tenantTransaction(context.organizationId, (client) =>
      listLeadAssignmentPolicies(client, context),
    );
    return ok({
      policies: policies.filter((policy) =>
        ["fixed", "round_robin"].includes(String(policy.mode)),
      ),
    });
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
