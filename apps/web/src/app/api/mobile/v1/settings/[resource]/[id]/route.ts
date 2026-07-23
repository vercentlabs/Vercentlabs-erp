import { incrementBillingUsage, requireBillingWriteAccess } from "@/lib/billing";
import { requirePermissionFromSession } from "@/lib/authorization";
import { HttpError, readJson } from "@/lib/http";
import { mobileError, mobileOk } from "@/lib/mobile-http";
import { requireMobileSession } from "@/lib/mobile-session";
import {
  isResourceKey,
  resourceDefinitions,
  updateResource,
} from "@/lib/resources";
import { audit } from "@/lib/security";
import { resourceSchemas } from "@/lib/validation";

export async function PATCH(
  request: Request,
  route: { params: Promise<{ resource: string; id: string }> },
) {
  try {
    const session = await requireMobileSession(request);
    if (!session.organizationId) {
      throw new HttpError(401, "Sign in to an organisation workspace.");
    }
    const { resource, id } = await route.params;
    if (!isResourceKey(resource)) {
      throw new HttpError(404, "Unknown settings resource.");
    }
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
    return mobileOk(request, { message: "Record updated." });
  } catch (error) {
    return mobileError(request, error);
  }
}
