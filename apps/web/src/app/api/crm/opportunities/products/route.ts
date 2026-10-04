import { searchOpportunityProducts } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// Products and services that can be put on a deal. Query: search
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView }, async ({ client, session }) =>
    ok({ products: await searchOpportunityProducts(client, crmContext(session), new URL(request.url).searchParams.get("search") ?? "") }),
  );
}
