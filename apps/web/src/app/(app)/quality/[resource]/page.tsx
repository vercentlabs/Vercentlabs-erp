import { listQualityResource } from "@vercentlabs/api";

import AccessDenied from "@/components/access-denied";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";
import { qualityContext } from "@/lib/quality";

export const dynamic = "force-dynamic";

export default async function QualityResourcePage({
  params,
}: {
  params: Promise<{ resource: string }>;
}) {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.qualityView)) {
    return <AccessDenied area="Quality" />;
  }

  const { resource } = await params;
  const rows = await tenantTransaction(session.organizationId, (client) =>
    listQualityResource(client, qualityContext(session), resource, {
      limit: 100,
    }),
  );

  return (
    <section className="panel">
      <p className="eyebrow">Quality</p>
      <h1>{resource.replaceAll("-", " ")}</h1>
      <p>{rows.length} records</p>
      <div className="table-panel">
        <table>
          <thead>
            <tr>
              <th>Record</th>
              <th>Status / severity</th>
              <th>Source / due date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: Record<string, unknown>) => (
              <tr key={String(row.id)}>
                <td>
                  <code>
                    {String(
                      row.inspection_number ||
                        row.nonconformance_number ||
                        row.capa_number ||
                        row.audit_number ||
                        row.hold_number ||
                        row.code ||
                        row.id,
                    )}
                  </code>
                </td>
                <td>
                  {String(
                    row.status ||
                      row.severity ||
                      row.quality_score ||
                      row.result_status ||
                      "",
                  )}
                </td>
                <td>
                  {String(
                    row.source_type ||
                      row.due_date ||
                      row.planned_date ||
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
