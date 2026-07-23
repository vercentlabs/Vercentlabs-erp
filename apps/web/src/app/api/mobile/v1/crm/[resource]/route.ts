import { createCrmRecord, getCrmOptions, listCrmRecords } from "@vercent/api";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/lib/billing";
import { requireCrmManage, requireCrmResourceView } from "@/lib/crm-api";
import { crmContext, crmDefinitions, isCrmDefinition, rethrowCrmError } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { readJson } from "@/lib/http";
import { crmSchemas } from "@/lib/crm-validation";
import { audit } from "@/lib/security";
import { mobileError, mobileOk } from "@/lib/mobile-http";
import { requireMobileSession } from "@/lib/mobile-session";
import { withMobileIdempotency } from "@/lib/mobile-idempotency";

export async function GET(request: Request, route: { params: Promise<{ resource: string }> }) {
  try {
    const session = await requireMobileSession(request);
    const { resource } = await route.params;
    if (!isCrmDefinition(resource)) {
      throw new HttpError(404, "Unknown CRM resource.");
    }
    requireCrmResourceView(session, resource);
    const url = new URL(request.url);
    const context = crmContext(session);
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
    const context = crmContext(session);
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
