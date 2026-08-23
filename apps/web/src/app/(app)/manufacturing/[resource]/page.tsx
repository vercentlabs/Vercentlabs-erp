import { listManufacturingResource } from "@vercentlabs/api";

import AccessDenied from "@/shared/components/access-denied";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { manufacturingContext } from "@/modules/manufacturing";

export const dynamic = "force-dynamic";

export default async function ManufacturingResourcePage({
  params,
}: {
  params: Promise<{ resource: string }>;
}) {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.manufacturingView)) {
    return <AccessDenied area="Manufacturing" />;
  }

  const { resource } = await params;
  const rows = await tenantTransaction(session.organizationId, (client) =>
    listManufacturingResource(client, manufacturingContext(session), resource, {
      limit: 100,
    }),
  );

  return (
    <section className="panel">
      <p className="eyebrow">Manufacturing</p>
      <h1>{resource.replaceAll("-", " ")}</h1>
      <p>{rows.length} records</p>
      <div className="table-panel">
        <table>
          <thead>
            <tr>
              <th>Record</th>
              <th>Status / quantity</th>
              <th>Schedule / updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: Record<string, unknown>) => (
              <tr key={String(row.id)}>
                <td>
                  <code>
                    {String(
                      row.work_order_number ||
                        row.code ||
                        row.posting_number ||
                        row.run_number ||
                        row.name ||
                        row.id,
                    )}
                  </code>
                </td>
                <td>
                  {String(
                    row.status ||
                      row.quantity_planned ||
                      row.quantity ||
                      row.net_requirement ||
                      "",
                  )}
                </td>
                <td>
                  {String(
                    row.planned_start_at ||
                      row.updated_at ||
                      row.created_at ||
                      row.posted_at ||
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
