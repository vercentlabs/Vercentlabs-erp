import { listPointOfSaleResource } from "@vercentlabs/api";

import AccessDenied from "@/components/access-denied";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";
import { pointOfSaleContext } from "@/lib/point-of-sale";

export const dynamic = "force-dynamic";

export default async function PointOfSaleResourcePage({
  params,
}: {
  params: Promise<{ resource: string }>;
}) {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.posView)) {
    return <AccessDenied area="Point of Sale" />;
  }

  const { resource } = await params;
  if (resource === "checkout") {
    return (
      <section className="panel">
        <p className="eyebrow">Point of Sale</p>
        <h1>Checkout</h1>
        <p>
          Use the secured POS API to scan items, validate Stock, collect
          payments and produce an auditable receipt.
        </p>
      </section>
    );
  }

  const rows = await tenantTransaction(session.organizationId, (client) =>
    listPointOfSaleResource(client, pointOfSaleContext(session), resource, {
      limit: 100,
    }),
  );

  return (
    <section className="panel">
      <p className="eyebrow">Point of Sale</p>
      <h1>{resource.replaceAll("-", " ")}</h1>
      <p>{rows.length} records</p>
      <div className="table-shell">
        <table>
          <thead>
            <tr>
              <th>Record</th>
              <th>Status / total</th>
              <th>Store / date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: Record<string, unknown>) => (
              <tr key={String(row.id)}>
                <td>
                  <code>
                    {String(
                      row.receipt_number ||
                        row.shift_number ||
                        row.return_number ||
                        row.code ||
                        row.movement_number ||
                        row.id,
                    )}
                  </code>
                </td>
                <td>
                  {String(
                    row.status ||
                      row.grand_total ||
                      row.amount ||
                      row.variance_amount ||
                      "",
                  )}
                </td>
                <td>
                  {String(
                    row.store_id ||
                      row.sale_date ||
                      row.opened_at ||
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
