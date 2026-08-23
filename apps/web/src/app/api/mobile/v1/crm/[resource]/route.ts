import { createCrmRecord, getCrmOptions, listCrmRecords } from "@vercentlabs/api";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { requireCrmManage, requireCrmResourceView } from "@/modules/crm/api";
import { crmApiContext, crmDefinitions, isCrmDefinition, rethrowCrmError } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { HttpError } from "@/core/http";
import { readJson } from "@/core/http";
import { crmSchemas } from "@/modules/crm/validation";
import { audit } from "@/core/security";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";
import { withMobileIdempotency } from "@/core/mobile-idempotency";

export async function GET(request: Request, route: { params: Promise<{ resource: string }> }) {
  try {
    const session = await requireMobileSession(request);
    const { resource } = await route.params;
    if (!isCrmDefinition(resource)) {
      throw new HttpError(404, "Unknown CRM resource.");
    }
    requireCrmResourceView(session, resource);
    const url = new URL(request.url);
    const context = await crmApiContext(session);
    const result = await tenantTransaction(context.organizationId, async (client) => ({
      records: await listCrmRecords(
        client,
        context,
        resource,
        Object.fromEntries(url.searchParams.entries()),
      ),
      options: await getCrmOptions(client, context),
    }));
    return mobileOk(request, {
      definition: crmDefinitions[resource],
      ...result.records,
      options: result.options,
    });
  } catch (error) {
    try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); }
  }
}

export async function POST(request: Request, route: { params: Promise<{ resource: string }> }) {
  try {
    const session = await requireMobileSession(request);
    const { resource } = await route.params;
    if (!isCrmDefinition(resource)) throw new HttpError(404, "Unknown CRM resource.");
    requireCrmManage(session, resource);
    await requireBillingWriteAccess(session.organizationId!);
    const input = await crmSchemas[resource].parseAsync(await readJson(request));
    await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const context = await crmApiContext(session);
    const response = await tenantTransaction(context.organizationId, async (client) => withMobileIdempotency(client, session, request, input, async () => {
      const record = await createCrmRecord(client, context, resource, input);
      await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: `crm.${resource}.created`, entityType: resource, entityId: String(record.id), afterData: input, request, client });
      return { message: "CRM record created.", record };
    }));
    return mobileOk(request, response, 201);
  } catch (error) {
    try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); }
  }
}
