import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/core/billing";
import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession } from "@/core/authorization";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import {
  isResourceKey,
  resourceDefinitions,
  updateResource,
} from "@/core/resources";
import { assertSameOrigin, audit } from "@/core/security";
import { resourceSchemas } from "@/core/validation";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ resource: string; id: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    const { resource, id } = await context.params;
    if (!isResourceKey(resource))
      throw new HttpError(404, "Unknown settings resource.");
    requirePermissionFromSession(
      session,
      resourceDefinitions[resource].permission,
    );
    await requireBillingWriteAccess(session.organizationId);
    const input = resourceSchemas[resource].parse(
      await readJson(request),
    ) as Record<string, unknown>;
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    await updateResource(resource, session.organizationId, id, input);
    await audit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: `${resource}.updated`,
      entityType: resource,
      entityId: id,
      afterData: input,
      request,
    });
    return ok({ message: "Record updated." });
  } catch (error) {
    return errorResponse(error);
  }
}
