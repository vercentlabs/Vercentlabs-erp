import { addTaskDependency, listTaskDependencies } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requireBillingWriteAccess, incrementBillingUsage } from "@/core/billing";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { assertCrmIdentifier } from "@/modules/crm/api";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";

type Route = { params: Promise<{ id: string }> };

// F015: Task dependencies (DEC-CRM-P1-F015 REQUIRED scope). A deliberately
// flat blocking-edge list, not a project-management dependency scheduler
// — cycle prevention is enforced server-side in addTaskDependency itself.
export async function GET(_request: Request, { params }: Route) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const { id } = await params; assertCrmIdentifier(id);
    const context = await crmApiContext(session);
    return ok({ rows: await tenantTransaction(context.organizationId, (client) => listTaskDependencies(client, context, id)) });
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return errorResponse(mapped); } }
}

export async function POST(request: Request, { params }: Route) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmActivitiesManage);
    await requireBillingWriteAccess(session.organizationId);
    const { id } = await params; assertCrmIdentifier(id);
    const rawInput = await readJson(request);
    if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput))
      throw new HttpError(400, "Dependency input must be a JSON object.", "CRM_TASK_INPUT_INVALID");
    const dependsOnTaskId = String((rawInput as Record<string, unknown>).dependsOnTaskId || "");
    assertCrmIdentifier(dependsOnTaskId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const record = await tenantTransaction(context.organizationId, async (client) => {
      const result = await addTaskDependency(client, context, id, dependsOnTaskId);
      await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: "crm.task.dependency_added", entityType: "task", entityId: id, metadata: { dependsOnTaskId }, request, client });
      return result;
    });
    return ok({ message: "Dependency added.", record }, 201);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return errorResponse(mapped); } }
}
