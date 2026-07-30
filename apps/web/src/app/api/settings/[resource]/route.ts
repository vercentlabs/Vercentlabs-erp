import {
  assertOrganizationLimit,
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/lib/billing";
import { getSessionContext } from "@/lib/auth";
import { transaction } from "@/lib/db";
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
    const organizationId = session.organizationId;
    const { resource } = await context.params;
    if (!isResourceKey(resource))
      throw new HttpError(404, "Unknown settings resource.");
    requirePermissionFromSession(
      session,
      resourceDefinitions[resource].permission,
    );
    await requireBillingWriteAccess(organizationId);
    const input = resourceSchemas[resource].parse(
      await readJson(request),
    ) as Record<string, unknown>;
    await incrementBillingUsage(organizationId, "api_requests_monthly");
    const created = await transaction(async (client) => {
      if (resource === "companies" || resource === "branches") {
        await assertOrganizationLimit(organizationId, resource, client);
      }
      const record = await createResource(
        resource,
        organizationId,
        session.userId,
        input,
        client,
      );
      await audit({
        organizationId: organizationId,
        actorUserId: session.userId,
        eventType: `${resource}.created`,
        entityType: resource,
        entityId: record.id,
        afterData: input,
        request,
        client,
      });
      return record;
    });
    return ok({ message: "Record created.", id: created.id }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
