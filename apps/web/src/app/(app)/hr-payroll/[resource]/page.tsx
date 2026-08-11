import { listHrPayrollResource } from "@vercentlabs/api";

import AccessDenied from "@/components/access-denied";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";
import { hrPayrollContext } from "@/lib/hr-payroll";

export const dynamic = "force-dynamic";

export default async function HrPayrollResourcePage({
  params,
}: {
  params: Promise<{ resource: string }>;
}) {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.hrPayrollView)) {
    return <AccessDenied area="HR & Payroll" />;
  }

  const { resource } = await params;
  const rows = await tenantTransaction(session.organizationId, (client) =>
    listHrPayrollResource(client, hrPayrollContext(session), resource, {
      limit: 100,
    }),
  );

  return (
    <section className="panel">
      <p className="eyebrow">HR &amp; Payroll</p>
      <h1>{resource.replaceAll("-", " ")}</h1>
      <p>{rows.length} records</p>
      <div className="table-panel">
        <table>
          <thead>
            <tr>
              <th>Record</th>
              <th>Status / value</th>
              <th>Employee / date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: Record<string, unknown>) => (
              <tr key={String(row.id)}>
                <td>
                  <code>
                    {String(
                      row.employee_number ||
                        row.payroll_number ||
                        row.payslip_number ||
                        row.expense_number ||
                        row.code ||
                        row.id,
                    )}
                  </code>
                </td>
                <td>
                  {String(
                    row.status ||
                      row.net_pay ||
                      row.amount ||
                      row.days ||
                      row.name ||
                      "",
                  )}
                </td>
                <td>
                  {String(
                    row.employee_id ||
                      row.joining_date ||
                      row.attendance_date ||
                      row.payment_date ||
                      row.created_at ||
                      "",
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
