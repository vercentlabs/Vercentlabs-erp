import {
  getCrmLeadIntelligenceReadiness,
  getCrmOptions,
  getLeadIntelligenceDashboard,
  listLeadAssignmentPolicies,
} from "@vercentlabs/api";

import AccessDenied from "@/components/access-denied";
import CrmLeadIntelligenceWorkspace from "@/components/crm-lead-intelligence-workspace";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";

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
