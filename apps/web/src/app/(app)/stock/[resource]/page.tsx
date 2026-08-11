import { listStockResource } from "@vercentlabs/api";
import AccessDenied from "@/components/access-denied";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";
import { stockContext } from "@/lib/stock";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ resource: string }>;
}) {
  const s = await requireWorkspace();
  if (!hasPermission(s, PERMISSIONS.stockView))
    return <AccessDenied area="Stock" />;
  const { resource } = await params;
  const rows = await tenantTransaction(s.organizationId, (c) =>
    listStockResource(c, stockContext(s), resource, { limit: 100 }),
  );
  return (
    <section className="panel">
      <p className="eyebrow">Stock</p>
      <h1>{resource.replaceAll("-", " ")}</h1>
      <p>{rows.length} records</p>
      <div className="table-panel">
        <table>
          <thead>
            <tr>
              <th>Record</th>
              <th>Status / quantity</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: Record<string, unknown>) => (
              <tr key={String(r.id || `${r.item_id}-${r.warehouse_id}`)}>
                <td>
                  <code>
                    {String(
                      r.movement_number ||
                        r.transfer_number ||
                        r.serial_number ||
                        r.batch_number ||
                        r.item_id ||
                        r.id,
                    )}
                  </code>
                </td>
                <td>{String(r.status || r.quantity || "")}</td>
                <td>
                  {String(r.updated_at || r.created_at || r.occurred_at || "")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
