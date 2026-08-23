import { listSupportResource } from "@vercentlabs/api";

import AccessDenied from "@/shared/components/access-denied";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { supportContext } from "@/modules/support";

export const dynamic = "force-dynamic";

export default async function SupportResourcePage({
  params,
}: {
  params: Promise<{ resource: string }>;
}) {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.supportView)) {
    return <AccessDenied area="Support" />;
  }

  const { resource } = await params;
  const rows = await tenantTransaction(session.organizationId, (client) =>
    listSupportResource(client, supportContext(session), resource, {
      limit: 100,
    }),
  );

  return (
    <section className="panel">
      <p className="eyebrow">Support</p>
      <h1>{resource.replaceAll("-", " ")}</h1>
      <p>{rows.length} records</p>
      <div className="table-panel">
        <table>
          <thead>
            <tr>
              <th>Record</th>
              <th>Status / priority</th>
              <th>Customer / owner</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: Record<string, unknown>) => (
              <tr key={String(row.id)}>
                <td>
                  <code>
                    {String(
                      row.ticket_number ||
                        row.article_number ||
                        row.code ||
                        row.name ||
                        row.id,
                    )}
                  </code>
                </td>
                <td>
                  {String(
                    row.status ||
                      row.priority ||
                      row.escalation_level ||
                      row.visibility ||
                      "",
                  )}
                </td>
                <td>
                  {String(
                    row.customer_name ||
                      row.assigned_user_id ||
                      row.queue_id ||
                      row.manager_user_id ||
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
