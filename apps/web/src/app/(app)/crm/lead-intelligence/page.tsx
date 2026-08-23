import {
  getCrmLeadIntelligenceReadiness,
  getCrmOptions,
  getLeadIntelligenceDashboard,
  listLeadAssignmentPolicies,
} from "@vercentlabs/api";

import AccessDenied from "@/shared/components/access-denied";
import CrmLeadIntelligenceWorkspace from "@/modules/crm/components/lead-intelligence-workspace";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { crmContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;

export default async function LeadIntelligencePage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView))
    return <AccessDenied area="lead intelligence" returnHref="/crm" />;
  const context = crmContext(session);
  const [dashboard, readiness, options, policies] = await tenantTransaction(
    context.organizationId,
    (client) => Promise.all([
      getLeadIntelligenceDashboard(client, context),
      getCrmLeadIntelligenceReadiness(client, context),
      getCrmOptions(client, context),
      listLeadAssignmentPolicies(client, context),
    ]),
  );
  return <CrmLeadIntelligenceWorkspace
    dashboard={JSON.parse(JSON.stringify(dashboard)) as Row}
    readiness={JSON.parse(JSON.stringify(readiness)) as Row}
    options={JSON.parse(JSON.stringify(options))}
    initialPolicies={JSON.parse(JSON.stringify(policies)) as Row[]}
    canManage={hasPermission(session, PERMISSIONS.crmLeadsManage)}
    canManageRouting={hasPermission(session, PERMISSIONS.crmLeadsManage) && hasPermission(session, PERMISSIONS.crmRecordsViewAll)}
  />;
}
