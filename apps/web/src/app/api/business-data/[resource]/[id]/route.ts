import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/lib/billing";
import {
  archiveBusinessDataRecord,
  updateBusinessDataRecord,
} from "@vercentlabs/api";

import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession } from "@/lib/authorization";
import {
  businessDataContext,
  businessDataDefinitions,
  isBusinessDataDefinition,
  rethrowBusinessDataError,
} from "@/lib/business-data";
import { businessDataPatchSchemas } from "@/lib/business-data-validation";
import { tenantTransaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin, audit } from "@/lib/security";

function assertIdentifier(id: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  ) {
    throw new HttpError(400, "Invalid record identifier.");
  }
}

export async function PATCH(
  request: Request,
  routeContext: {
    params: Promise<{ resource: string; id: string }>;
  },
) {
  try {
    assertSameOrigin(request);

    const session = await getSessionContext();
    if (!session?.organizationId) {
      throw new HttpError(401, "Sign in to an organisation workspace.");
    }

    const { resource, id } = await routeContext.params;
    if (!isBusinessDataDefinition(resource)) {
      throw new HttpError(404, "Unknown business-data resource.");
    }
    assertIdentifier(id);

    const definition = businessDataDefinitions[resource];
    requirePermissionFromSession(session, definition.managePermission);
    await requireBillingWriteAccess(session.organizationId);
    const input = businessDataPatchSchemas[resource].parse(
      await readJson(request),
    ) as Record<string, unknown>;
    if (!Object.keys(input).length) {
      throw new HttpError(400, "Provide at least one field to update.");
    }
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = businessDataContext(session);

    const updated = await tenantTransaction(context.organizationId, (client) =>
      updateBusinessDataRecord(client, context, resource, id, input),
    );

    await audit({
      organizationId: context.organizationId,
      actorUserId: session.userId,
      eventType: `business_data.${resource}.updated`,
      entityType: resource,
      entityId: id,
      afterData: input,
      request,
    });

    return ok({
      message: `${definition.singular[0].toUpperCase()}${definition.singular.slice(1)} updated.`,
      record: updated,
    });
  } catch (error) {
    try {
      rethrowBusinessDataError(error);
    } catch (mappedError) {
      return errorResponse(mappedError);
    }
  }
}

export async function DELETE(
  request: Request,
  routeContext: {
    params: Promise<{ resource: string; id: string }>;
  },
) {
  try {
    assertSameOrigin(request);

    const session = await getSessionContext();
    if (!session?.organizationId) {
      throw new HttpError(401, "Sign in to an organisation workspace.");
    }

    const { resource, id } = await routeContext.params;
    if (!isBusinessDataDefinition(resource)) {
      throw new HttpError(404, "Unknown business-data resource.");
    }
    assertIdentifier(id);

    const definition = businessDataDefinitions[resource];
    requirePermissionFromSession(session, definition.managePermission);
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = businessDataContext(session);

    const archived = await tenantTransaction(context.organizationId, (client) =>
      archiveBusinessDataRecord(client, context, resource, id),
    );

    await audit({
      organizationId: context.organizationId,
      actorUserId: session.userId,
      eventType: `business_data.${resource}.archived`,
      entityType: resource,
      entityId: id,
      afterData: { status: archived.status },
      request,
    });

    return ok({
      message: `${definition.singular[0].toUpperCase()}${definition.singular.slice(1)} archived.`,
      record: archived,
    });
  } catch (error) {
    try {
      rethrowBusinessDataError(error);
    } catch (mappedError) {
      return errorResponse(mappedError);
    }
  }
}
