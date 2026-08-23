import { notFound } from "next/navigation";
import { previewPrivacyRequest } from "@vercentlabs/api";
import CrmPrivacyActions from "@/modules/crm/components/privacy-actions";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { crmContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;

export default async function PrivacyRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmPrivacyManage)) return notFound();
  const context = crmContext(session);
  let preview: Row;
  try {
    preview = (await tenantTransaction(context.organizationId, (client) =>
      previewPrivacyRequest(client, context, id),
    )) as Row;
  } catch {
    return notFound();
  }
  const request = preview.request as Row;
  const subject = preview.subject as Row;
  const counts = preview.counts as Row;
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">CRM · Privacy request</p>
          <h1>{String(request.request_type).replaceAll("_", " ")}</h1>
          <p>
            {String(request.subject_type)} · {String(request.subject_id)}
          </p>
        </div>
        <span className="status-badge neutral">{String(request.status)}</span>
      </section>
      <CrmPrivacyActions
        requestId={id}
        requestType={String(request.request_type)}
        ready={Boolean(preview.ready)}
        blockers={(preview.blockers || []) as string[]}
      />
      <div className="module-dashboard-grid">
        <section className="panel module-panel">
          <p className="eyebrow">Subject</p>
          <h2>Current retained record</h2>
          <dl className="crm-detail-list">
            {Object.entries(subject)
              .slice(0, 24)
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{key.replaceAll("_", " ")}</dt>
                  <dd>
                    {value === null
                      ? "—"
                      : typeof value === "object"
                        ? JSON.stringify(value)
                        : String(value)}
                  </dd>
                </div>
              ))}
          </dl>
        </section>
        <section className="panel module-panel">
          <p className="eyebrow">Impact preview</p>
          <h2>Linked records</h2>
          <dl className="crm-detail-list">
            {Object.entries(counts).map(([key, value]) => (
              <div key={key}>
                <dt>{key.replaceAll("_", " ")}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </>
  );
}
