import { removeTaskDependency } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requireBillingWriteAccess, incrementBillingUsage } from "@/core/billing";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { assertCrmIdentifier } from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; dependsOnTaskId: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmActivitiesManage);
    await requireBillingWriteAccess(session.organizationId);
    const { id, dependsOnTaskId } = await params;
    assertCrmIdentifier(id);
    assertCrmIdentifier(dependsOnTaskId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    await tenantTransaction(context.organizationId, async (client) => {
      await removeTaskDependency(client, context, id, dependsOnTaskId);
      await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: "crm.task.dependency_removed", entityType: "task", entityId: id, metadata: { dependsOnTaskId }, request, client });
    });
    return ok({ message: "Dependency removed." });
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return errorResponse(mapped); } }
}
