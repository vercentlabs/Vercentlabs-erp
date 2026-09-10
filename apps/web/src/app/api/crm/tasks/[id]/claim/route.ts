import { claimCrmTask } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requireBillingWriteAccess, incrementBillingUsage } from "@/core/billing";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { assertCrmIdentifier } from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmActivitiesManage);
    await requireBillingWriteAccess(session.organizationId);
    const { id } = await params; assertCrmIdentifier(id);
    const rawInput = await readJson(request).catch(() => ({}));
    if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput))
      throw new HttpError(400, "Task claim input must be a JSON object.", "CRM_TASK_INPUT_INVALID");
    const input = rawInput as Record<string, unknown>;
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const record = await tenantTransaction(context.organizationId, async (client) => {
      const result = await claimCrmTask(client, context, id, input);
      await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: "crm.task.claimed", entityType: "task", entityId: id, metadata: { teamId: result.teamId, assignedTo: result.assignedTo }, request, client });
      return result;
    });
    return ok({ message: "Task claimed.", record });
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return errorResponse(mapped); } }
}
