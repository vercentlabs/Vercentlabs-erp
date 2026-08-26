import { assignLeadOwner } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import {
  hasPermission,
  PERMISSIONS,
  requirePermissionFromSession,
} from "@/core/authorization";
import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/api";

export async function POST(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsManage);
    if (
      !hasPermission(session, PERMISSIONS.crmRecordsViewAll) &&
      !session.roleSlugs.includes("organization_owner")
    )
      throw new HttpError(403, "You do not have permission to assign Leads.");
    const { id } = await route.params;
    assertCrmIdentifier(id);
    const input = (await readJson(request)) as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(input, "ownerUserId"))
      throw new HttpError(400, "Select a Lead owner.");
    const ownerUserId = input.ownerUserId ? String(input.ownerUserId) : null;
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const assigned = await assignLeadOwner(
          client,
          context,
          id,
          ownerUserId,
          {
            reason: "manual:lead-detail",
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
        return assigned;
      },
    );
    return ok({
      message: result.assignment.changed
        ? result.assignment.ownerUserId
          ? "Lead owner changed."
          : "Lead is now unassigned."
        : "Lead owner was already selected.",
      ...result,
    });
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
