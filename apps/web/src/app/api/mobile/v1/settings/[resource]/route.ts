import {
  assertOrganizationLimit,
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/lib/billing";
import { requirePermissionFromSession } from "@/lib/authorization";
import { transaction } from "@/lib/db";
import { HttpError, readJson } from "@/lib/http";
import { mobileError, mobileOk } from "@/lib/mobile-http";
import { withMobileIdempotency } from "@/lib/mobile-idempotency";
import { requireMobileSession } from "@/lib/mobile-session";
import {
  createResource,
  isResourceKey,
  listResource,
  resourceDefinitions,
  resourceOptions,
} from "@/lib/resources";
import { audit } from "@/lib/security";
import { resourceSchemas } from "@/lib/validation";

async function context(request: Request, resource: string) {
  const session = await requireMobileSession(request);
  if (!session.organizationId) {
    throw new HttpError(401, "Sign in to an organisation workspace.");
  }
  if (!isResourceKey(resource)) {
    throw new HttpError(404, "Unknown settings resource.");
  }
  const definition = resourceDefinitions[resource];
  requirePermissionFromSession(session, definition.permission);
  return { session, definition, resource };
}

export async function GET(
  request: Request,
  route: { params: Promise<{ resource: string }> },
) {
  try {
    const { resource: value } = await route.params;
    const { session, definition, resource } = await context(request, value);
    const [rows, options] = await Promise.all([
      listResource(resource, session.organizationId!),
      resourceOptions(session.organizationId!),
    ]);
    return mobileOk(request, { definition, rows, options });
  } catch (error) {
    return mobileError(request, error);
  }
}

export async function POST(
  request: Request,
  route: { params: Promise<{ resource: string }> },
) {
  try {
    const { resource: value } = await route.params;
    const { session, resource } = await context(request, value);
    await requireBillingWriteAccess(session.organizationId!);
    if (resource === "companies" || resource === "branches") {
      await assertOrganizationLimit(session.organizationId!, resource);
    }
    const input = resourceSchemas[resource].parse(
      await readJson(request),
    ) as Record<string, unknown>;
    await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const created = await transaction(async (client) =>
      withMobileIdempotency(client, session, request, input, async () => {
        const record = await createResource(
          resource,
          session.organizationId!,
          session.userId,
          input,
          client,
        );
        await audit({
          organizationId: session.organizationId!,
          actorUserId: session.userId,
          eventType: `${resource}.created`,
          entityType: resource,
          entityId: record.id,
          afterData: input,
          request,
          client,
        });
        return record;
      }),
    );
    return mobileOk(request, { message: "Record created.", id: created.id }, 201);
  } catch (error) {
    return mobileError(request, error);
  }
}
