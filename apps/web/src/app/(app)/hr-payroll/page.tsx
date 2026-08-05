import { getHrPayrollDashboard } from "@vercentlabs/api";

import AccessDenied from "@/components/access-denied";
import HrPayrollDashboard from "@/components/hr-payroll/hr-payroll-dashboard";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";
import { hrPayrollContext } from "@/lib/hr-payroll";

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
