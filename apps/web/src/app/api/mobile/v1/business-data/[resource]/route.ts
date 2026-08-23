import {
  createBusinessDataRecord,
  getBusinessDataOptions,
  listBusinessDataRecords,
} from "@vercentlabs/api";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import {
  businessDataContext,
  businessDataDefinitions,
  isBusinessDataDefinition,
  rethrowBusinessDataError,
} from "@/core/master-data";
import { businessDataSchemas } from "@/core/master-data-validation";
import { tenantTransaction } from "@/core/db";
import { HttpError, readJson } from "@/core/http";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { withMobileIdempotency } from "@/core/mobile-idempotency";
import { requireMobileSession } from "@/core/mobile-session";
import { audit } from "@/core/security";

export async function GET(
  request: Request,
  route: { params: Promise<{ resource: string }> },
) {
  try {
    const session = await requireMobileSession(request);
    if (!session.organizationId) throw new HttpError(401, "Workspace required.");
    const { resource } = await route.params;
    if (!isBusinessDataDefinition(resource)) {
      throw new HttpError(404, "Unknown master-data resource.");
    }
    requirePermissionFromSession(session, PERMISSIONS.businessDataView);
    const url = new URL(request.url);
    const context = businessDataContext(session);
    const result = await tenantTransaction(context.organizationId, async (client) => ({
      records: await listBusinessDataRecords(client, context, resource, {
        search: url.searchParams.get("search") || "",
        status: url.searchParams.get("status") || "all",
        limit: Number(url.searchParams.get("limit") || "100"),
        offset: Number(url.searchParams.get("offset") || "0"),
      }),
      options: await getBusinessDataOptions(client, context),
    }));
    return mobileOk(request, {
      definition: businessDataDefinitions[resource],
      ...result,
    });
  } catch (error) {
    try {
      rethrowBusinessDataError(error);
    } catch (mapped) {
      return mobileError(request, mapped);
    }
  }
}

export async function POST(
  request: Request,
  route: { params: Promise<{ resource: string }> },
) {
  try {
    const session = await requireMobileSession(request);
    if (!session.organizationId) throw new HttpError(401, "Workspace required.");
    const { resource } = await route.params;
    if (!isBusinessDataDefinition(resource)) {
      throw new HttpError(404, "Unknown master-data resource.");
    }
    const definition = businessDataDefinitions[resource];
    requirePermissionFromSession(session, definition.managePermission);
    await requireBillingWriteAccess(session.organizationId);
    const input = businessDataSchemas[resource].parse(
      await readJson(request),
    ) as Record<string, unknown>;
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = businessDataContext(session);
    const response = await tenantTransaction(context.organizationId, (client) =>
      withMobileIdempotency(client, session, request, input, async () => {
        const record = await createBusinessDataRecord(client, context, resource, input);
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: `business_data.${resource}.created`,
          entityType: resource,
          entityId: String(record.id),
          afterData: input,
          request,
          client,
        });
        return { message: `${definition.singular} created.`, record };
      }),
    );
    return mobileOk(request, response, 201);
  } catch (error) {
    try {
      rethrowBusinessDataError(error);
    } catch (mapped) {
      return mobileError(request, mapped);
    }
  }
}
