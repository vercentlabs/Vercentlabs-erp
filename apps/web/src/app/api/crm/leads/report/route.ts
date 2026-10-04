import { getLeadsByStatusReport } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// CRM Leads by Status. Query: groupBy, ownerId, teamId, sourceId, status, stage,
// converted, createdFrom, createdTo, assignedFrom, assignedTo,
// qualificationStatus, disqualificationReason, productInterest, qualifiedFrom, qualifiedTo,
// rating, stageEnteredFrom, stageEnteredTo.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.reportsView }, async ({ client, session }) =>
    ok({ report: await getLeadsByStatusReport(client, crmContext(session), Object.fromEntries(new URL(request.url).searchParams)) }),
  );
}
