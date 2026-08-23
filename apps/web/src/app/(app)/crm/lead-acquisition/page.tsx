import {
  getCrmLeadAcquisitionReadiness,
  getCrmOptions,
  getLeadAcquisitionDashboard,
} from "@vercentlabs/api";

import AccessDenied from "@/shared/components/access-denied";
import CrmLeadAcquisitionWorkspace from "@/modules/crm/components/lead-acquisition-workspace";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { crmContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";

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
