import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/lib/billing";
import {
  createBusinessDataRecord,
  listBusinessDataRecords,
} from "@vercent/api";

import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import {
  businessDataContext,
  businessDataDefinitions,
  isBusinessDataDefinition,
  rethrowBusinessDataError,
} from "@/lib/business-data";
import { businessDataSchemas } from "@/lib/business-data-validation";
import { tenantTransaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin, audit } from "@/lib/security";

export async function GET(
  request: Request,
  routeContext: { params: Promise<{ resource: string }> },
) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) {
      throw new HttpError(401, "Sign in to an organisation workspace.");
    }

    const { resource } = await routeContext.params;
    if (!isBusinessDataDefinition(resource)) {
      throw new HttpError(404, "Unknown business-data resource.");
    }

    requirePermissionFromSession(session, PERMISSIONS.businessDataView);

    const url = new URL(request.url);
    const context = businessDataContext(session);
    const result = await tenantTransaction(context.organizationId, (client) =>
      listBusinessDataRecords(client, context, resource, {
        search: url.searchParams.get("search") || "",
        status: url.searchParams.get("status") || "all",
        limit: Number(url.searchParams.get("limit") || "100"),
        offset: Number(url.searchParams.get("offset") || "0"),
      }),
    );

    return ok(result);
  } catch (error) {
    try {
      rethrowBusinessDataError(error);
    } catch (mappedError) {
      return errorResponse(mappedError);
    }
  }
}

export async function POST(
  request: Request,
  routeContext: { params: Promise<{ resource: string }> },
) {
  try {
    assertSameOrigin(request);

    const session = await getSessionContext();
    if (!session?.organizationId) {
      throw new HttpError(401, "Sign in to an organisation workspace.");
    }

    const { resource } = await routeContext.params;
    if (!isBusinessDataDefinition(resource)) {
      throw new HttpError(404, "Unknown business-data resource.");
    }

    const definition = businessDataDefinitions[resource];
    requirePermissionFromSession(session, definition.managePermission);
    await requireBillingWriteAccess(session.organizationId);
    const input = businessDataSchemas[resource].parse(
      await readJson(request),
    ) as Record<string, unknown>;
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = businessDataContext(session);

    const created = await tenantTransaction(context.organizationId, (client) =>
      createBusinessDataRecord(client, context, resource, input),
    );

    await audit({
      organizationId: context.organizationId,
      actorUserId: session.userId,
      eventType: `business_data.${resource}.created`,
      entityType: resource,
      entityId: String(created.id),
      afterData: input,
      request,
    });

    return ok(
      {
        message: `${definition.singular[0].toUpperCase()}${definition.singular.slice(1)} created.`,
        record: created,
      },
      201,
    );
  } catch (error) {
    try {
      rethrowBusinessDataError(error);
    } catch (mappedError) {
      return errorResponse(mappedError);
    }
  }
}
