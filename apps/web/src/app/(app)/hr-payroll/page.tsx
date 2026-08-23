import { getHrPayrollDashboard } from "@vercentlabs/api";

import AccessDenied from "@/shared/components/access-denied";
import HrPayrollDashboard from "@/modules/hr-payroll/components/hr-payroll-dashboard";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { hrPayrollContext } from "@/modules/hr-payroll";

export const metadata = { title: "HR & Payroll" };
export const dynamic = "force-dynamic";

export default async function HrPayrollPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.hrPayrollView)) {
    return <AccessDenied area="HR & Payroll" />;
  }

  const summary = await tenantTransaction(session.organizationId, (client) =>
    getHrPayrollDashboard(client, hrPayrollContext(session)),
  );

  return <HrPayrollDashboard summary={summary} />;
}
