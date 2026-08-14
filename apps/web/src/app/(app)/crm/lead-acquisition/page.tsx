import {
  getCrmLeadAcquisitionReadiness,
  getCrmOptions,
  getLeadAcquisitionDashboard,
} from "@vercentlabs/api";

import AccessDenied from "@/components/access-denied";
import CrmLeadAcquisitionWorkspace from "@/components/crm-lead-acquisition-workspace";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;

export default async function LeadAcquisitionPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView))
    return <AccessDenied area="lead acquisition" returnHref="/crm" />;
  const context = crmContext(session);
  const [dashboard, readiness, options] = await tenantTransaction(
    context.organizationId,
    (client) => Promise.all([
      getLeadAcquisitionDashboard(client, context),
      getCrmLeadAcquisitionReadiness(client, context),
      getCrmOptions(client, context),
    ]),
  );
  return <CrmLeadAcquisitionWorkspace
    dashboard={JSON.parse(JSON.stringify(dashboard)) as Row}
    readiness={JSON.parse(JSON.stringify(readiness)) as Row}
    options={JSON.parse(JSON.stringify(options))}
    permissions={{
      canImport: hasPermission(session, PERMISSIONS.crmImport),
      canCapture: hasPermission(session, PERMISSIONS.crmCaptureManage),
      canIntegrate: hasPermission(session, PERMISSIONS.crmIntegrationsManage),
      canEnrich: hasPermission(session, PERMISSIONS.crmDataQualityManage),
    }}
  />;
}
