import { notFound } from "next/navigation";
import { getPrivacyRetentionDashboard } from "@vercentlabs/api";
import CrmPrivacyRetentionManager from "@/components/crm-privacy-retention-manager";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;

export default async function PrivacyRetentionPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmPrivacyManage)) return notFound();
  const context = crmContext(session);
  const dashboard = (await tenantTransaction(context.organizationId, (client) =>
    getPrivacyRetentionDashboard(client, context),
  )) as Row;
  const policies = (dashboard.policies || []) as Row[];
  const runs = (dashboard.runs || []) as Row[];
  const metrics = dashboard.metrics as Row;
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">CRM · Data governance</p>
          <h1>Privacy retention automation</h1>
          <p>
            Configure retention windows, run governed anonymisation and inspect
            immutable execution evidence.
          </p>
        </div>
        <span className="status-badge neutral">
          {String(metrics.activePolicies || 0)} active policies
        </span>
      </section>
      <CrmPrivacyRetentionManager
        policies={policies.map((row) => ({
          id: String(row.id),
          subjectType: String(row.subject_type),
          name: String(row.name),
          retentionDays: Number(row.retention_days),
          action: String(row.action),
          status: String(row.status),
          lastRunAt: row.last_run_at ? String(row.last_run_at) : null,
        }))}
      />
      <section className="panel">
        <p className="eyebrow">Immutable evidence</p>
        <h2>Recent executions</h2>
        <div className="crm-stage-summary">
          {runs.slice(0, 50).map((row) => (
            <div key={String(row.id)}>
              <span>
                <strong>
                  {String(row.subject_type)} · {String(row.operation)}
                </strong>
                <small>
                  {String(row.subject_id)} · {String(row.executed_at)}
                </small>
              </span>
              <b>{String(row.status)}</b>
            </div>
          ))}
          {!runs.length ? (
            <div className="empty-state">
              <p>No privacy retention execution has been recorded.</p>
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
