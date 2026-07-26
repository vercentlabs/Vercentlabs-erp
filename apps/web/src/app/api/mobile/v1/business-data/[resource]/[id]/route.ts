import {
  archiveBusinessDataRecord,
  updateBusinessDataRecord,
} from "@vercentlabs/api";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/lib/billing";
import { requirePermissionFromSession } from "@/lib/authorization";
import {
  businessDataContext,
  businessDataDefinitions,
  isBusinessDataDefinition,
  rethrowBusinessDataError,
} from "@/lib/business-data";
import { businessDataPatchSchemas } from "@/lib/business-data-validation";
import { tenantTransaction } from "@/lib/db";
import { HttpError, readJson } from "@/lib/http";
import { mobileError, mobileOk } from "@/lib/mobile-http";
import { withMobileIdempotency } from "@/lib/mobile-idempotency";
import { requireMobileSession } from "@/lib/mobile-session";
import { audit } from "@/lib/security";

function identifier(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "Invalid record identifier.");
}

async function mutate(
  request: Request,
  route: { params: Promise<{ resource: string; id: string }> },
  archive: boolean,
) {
  try {
    const session = await requireMobileSession(request);
    if (!session.organizationId) throw new HttpError(401, "Workspace required.");
    const { resource, id } = await route.params;
    if (!isBusinessDataDefinition(resource)) {
      throw new HttpError(404, "Unknown master-data resource.");
    }
    identifier(id);
    const definition = businessDataDefinitions[resource];
    requirePermissionFromSession(session, definition.managePermission);
    await requireBillingWriteAccess(session.organizationId);
    const input = archive
      ? { archive: true }
      : (businessDataPatchSchemas[resource].parse(
          await readJson(request),
        ) as Record<string, unknown>);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = businessDataContext(session);
    const response = await tenantTransaction(context.organizationId, (client) =>
      withMobileIdempotency(client, session, request, input, async () => {
        const record = archive
          ? await archiveBusinessDataRecord(client, context, resource, id)
          : await updateBusinessDataRecord(client, context, resource, id, input);
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: `business_data.${resource}.${archive ? "archived" : "updated"}`,
          entityType: resource,
          entityId: id,
          afterData: archive ? { status: record.status } : input,
          request,
          client,
        });
        return { message: `${definition.singular} ${archive ? "archived" : "updated"}.`, record };
      }),
    );
    return mobileOk(request, response);
  } catch (error) {
    try {
      rethrowBusinessDataError(error);
    } catch (mapped) {
      return mobileError(request, mapped);
    }
  }
}

export function PATCH(
  request: Request,
  route: { params: Promise<{ resource: string; id: string }> },
) {
  return mutate(request, route, false);
}

export function DELETE(
  request: Request,
  route: { params: Promise<{ resource: string; id: string }> },
) {
  return mutate(request, route, true);
}
