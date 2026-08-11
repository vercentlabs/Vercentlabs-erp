import { listAssetResource } from "@vercentlabs/api";

import AccessDenied from "@/components/access-denied";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";
import { assetsContext } from "@/lib/assets";

export const dynamic = "force-dynamic";

export default async function AssetResourcePage({
  params,
}: {
  params: Promise<{ resource: string }>;
}) {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.assetsView)) {
    return <AccessDenied area="Assets" />;
  }

  const { resource } = await params;
  const rows = await tenantTransaction(session.organizationId, (client) =>
    listAssetResource(client, assetsContext(session), resource, { limit: 100 }),
  );

  return (
    <section className="panel">
      <p className="eyebrow">Assets</p>
      <h1>{resource.replaceAll("-", " ")}</h1>
      <p>{rows.length} records</p>
      <div className="table-panel">
        <table>
          <thead>
            <tr>
              <th>Record</th>
              <th>Status / value</th>
              <th>Date / custodian</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: Record<string, unknown>) => (
              <tr key={String(row.id)}>
                <td>
                  <code>
                    {String(
                      row.asset_number ||
                        row.code ||
                        row.work_order_number ||
                        row.inspection_number ||
                        row.disposal_number ||
                        row.id,
                    )}
                  </code>
                </td>
                <td>
                  {String(
                    row.status ||
                      row.net_book_value ||
                      row.condition_rating ||
                      row.total_depreciation ||
                      "",
                  )}
                </td>
                <td>
                  {String(
                    row.next_due_date ||
                      row.inspection_date ||
                      row.disposal_date ||
                      row.current_user_id ||
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
