import { requestCrmExportJob, type CrmDataJobEntity } from "@vercentlabs/api/crm";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { accountFiltersFromUrl } from "@/features/crm/accounts/server/account-http";
import { contactFiltersFromUrl } from "@/features/crm/contacts/server/contact-http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { leadFiltersFromUrl } from "@/features/crm/leads/server/lead-http";
import { opportunityFiltersFromUrl } from "@/features/crm/opportunities/server/opportunity-http";

const FILTERS: Record<CrmDataJobEntity, (url: URL) => Record<string, unknown>> = {
  leads: leadFiltersFromUrl, accounts: accountFiltersFromUrl, contacts: contactFiltersFromUrl, opportunities: opportunityFiltersFromUrl,
};

// Queues an export too large to download at once: ?entity=… plus the same view and filters as the list's own export.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => {
    const url = new URL(request.url);
    const entity = url.searchParams.get("entity") as CrmDataJobEntity;
    if (!FILTERS[entity]) throw new HttpError(400, "Choose leads, companies, contacts or deals.");
    const job = await requestCrmExportJob(client, crmContext(session, snapshot), { entity, filters: FILTERS[entity](url) });
    return ok({ job }, 202);
  });
}
