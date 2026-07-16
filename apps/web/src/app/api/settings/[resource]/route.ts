import {
  assertOrganizationLimit,
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/lib/billing";
import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession } from "@/lib/authorization";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import {
  createResource,
  isResourceKey,
  resourceDefinitions,
} from "@/lib/resources";
import { assertSameOrigin, audit } from "@/lib/security";
import { resourceSchemas } from "@/lib/validation";

export async function POST(
  request: Request,
  context: { params: Promise<{ resource: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    const { resource } = await context.params;
    if (!isResourceKey(resource))
      throw new HttpError(404, "Unknown settings resource.");
    requirePermissionFromSession(
      session,
      resourceDefinitions[resource].permission,
    );
    await requireBillingWriteAccess(session.organizationId);
    if (resource === "companies") {
      await assertOrganizationLimit(session.organizationId, "companies");
    }
    if (resource === "branches") {
      await assertOrganizationLimit(session.organizationId, "branches");
    }
    const input = resourceSchemas[resource].parse(
      await readJson(request),
    ) as Record<string, unknown>;
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const created = await createResource(
      resource,
      session.organizationId,
      session.userId,
      input,
    );
    await audit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: `${resource}.created`,
      entityType: resource,
      entityId: created.id,
      afterData: input,
      request,
    });
    return ok({ message: "Record created.", id: created.id }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
