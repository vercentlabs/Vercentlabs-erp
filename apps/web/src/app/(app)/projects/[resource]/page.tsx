import { listProjectResource } from "@vercentlabs/api";

import AccessDenied from "@/shared/components/access-denied";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { projectsContext } from "@/modules/projects";

export const dynamic = "force-dynamic";

export default async function ProjectResourcePage({
  params,
}: {
  params: Promise<{ resource: string }>;
}) {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.projectsView)) {
    return <AccessDenied area="Projects" />;
  }
  const { resource } = await params;
  const rows = await tenantTransaction(session.organizationId, (client) =>
    listProjectResource(client, projectsContext(session), resource, {
      limit: 100,
    }),
  );

  return (
    <section className="panel">
      <p className="eyebrow">Projects</p>
      <h1>{resource.replaceAll("-", " ")}</h1>
      <p>{rows.length} records</p>
      <div className="table-panel">
        <table>
          <thead>
            <tr>
              <th>Record</th>
              <th>Status / amount</th>
              <th>Date / owner</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: Record<string, unknown>) => (
              <tr key={String(row.id)}>
                <td>
                  <code>
                    {String(
                      row.project_number ||
                        row.task_number ||
                        row.billing_number ||
                        row.name ||
                        row.id,
                    )}
                  </code>
                </td>
                <td>
                  {String(
                    row.status ||
                      row.amount ||
                      row.hours ||
                      row.gross_margin ||
                      "",
                  )}
                </td>
                <td>
                  {String(
                    row.planned_end_date ||
                      row.work_date ||
                      row.expense_date ||
                      row.snapshot_date ||
                      row.user_id ||
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
