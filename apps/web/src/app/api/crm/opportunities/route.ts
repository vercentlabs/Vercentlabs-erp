import { createOpportunity, listOpportunities } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { opportunityFiltersFromUrl, readBody } from "@/features/crm/opportunities/server/opportunity-http";

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView }, async ({ client, session }) => {
    const { opportunities, ...page } = await listOpportunities(client, crmContext(session), opportunityFiltersFromUrl(new URL(request.url)));
    return ok({ rows: opportunities, ...page });
  });
}

// Body: the opportunity fields, with accountId (required).
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesCreate, billingWrite: true }, async ({ client, session }) =>
    ok({ record: await createOpportunity(client, crmContext(session), await readBody(request)) }, 201),
  );
}
