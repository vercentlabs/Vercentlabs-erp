import { getLeadConversionMetrics } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// Leads converted, conversion rate, by owner, by source and the average days to convert: ?from&to
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsView }, async ({ client, session }) => {
    const url = new URL(request.url);
    return ok({ metrics: await getLeadConversionMetrics(client, crmContext(session), { from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined }) });
  });
}
