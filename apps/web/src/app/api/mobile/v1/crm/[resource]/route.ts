import { listCrmRecords } from "@vercent/api";
import { requireCrmResourceView } from "@/lib/crm-api";
import { crmContext, isCrmDefinition, rethrowCrmError } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { mobileError, mobileOk } from "@/lib/mobile-http";
import { requireMobileSession } from "@/lib/mobile-session";

const mobileResources = new Set(["leads", "opportunities", "activities", "pipeline-stages"]);

export async function GET(request: Request, route: { params: Promise<{ resource: string }> }) {
  try {
    const session = await requireMobileSession(request);
    const { resource } = await route.params;
    if (!mobileResources.has(resource) || !isCrmDefinition(resource)) {
      throw new HttpError(404, "Unknown mobile CRM resource.");
    }
    requireCrmResourceView(session, resource);
    const url = new URL(request.url);
    const context = crmContext(session);
    const result = await tenantTransaction(context.organizationId, (client) =>
      listCrmRecords(client, context, resource, Object.fromEntries(url.searchParams.entries())),
    );
    return mobileOk(request, result);
  } catch (error) {
    try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); }
  }
}
