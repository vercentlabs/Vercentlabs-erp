import { getCrmRecord, updateCrmRecord } from "@vercent/api";
import type { CrmResourceKey } from "@vercent/shared-types";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/lib/billing";
import { assertCrmIdentifier, requireCrmManage, requireCrmResourceView } from "@/lib/crm-api";
import { crmContext, isCrmDefinition, rethrowCrmError } from "@/lib/crm";
import { crmPatchSchemas } from "@/lib/crm-validation";
import { tenantTransaction } from "@/lib/db";
import { HttpError, readJson } from "@/lib/http";
import { mobileError, mobileOk } from "@/lib/mobile-http";
import { withMobileIdempotency } from "@/lib/mobile-idempotency";
import { requireMobileSession } from "@/lib/mobile-session";
import { audit } from "@/lib/security";

const resources = new Set(["leads", "opportunities", "activities", "pipeline-stages"]);

function valid(resource: string): asserts resource is CrmResourceKey {
  if (!resources.has(resource) || !isCrmDefinition(resource)) throw new HttpError(404, "Unknown mobile CRM resource.");
}

export async function GET(request: Request, route: { params: Promise<{ resource: string; id: string }> }) {
  try {
    const session = await requireMobileSession(request);
    const { resource, id } = await route.params;
    valid(resource); assertCrmIdentifier(id); requireCrmResourceView(session, resource);
    const context = crmContext(session);
    const record = await tenantTransaction(context.organizationId, (client) => getCrmRecord(client, context, resource, id));
    return mobileOk(request, { record });
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}

export async function PATCH(request: Request, route: { params: Promise<{ resource: string; id: string }> }) {
  try {
    const session = await requireMobileSession(request);
    const { resource, id } = await route.params;
    valid(resource); assertCrmIdentifier(id); requireCrmManage(session, resource);
    await requireBillingWriteAccess(session.organizationId!);
    const input = await crmPatchSchemas[resource].parseAsync(await readJson(request));
    await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const context = crmContext(session);
    const response = await tenantTransaction(context.organizationId, (client) => withMobileIdempotency(client, session, request, input, async () => {
      const record = await updateCrmRecord(client, context, resource, id, input);
      await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: `crm.${resource}.updated`, entityType: resource, entityId: id, afterData: input, request, client });
      return { message: "CRM record updated.", record };
    }));
    return mobileOk(request, response);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
