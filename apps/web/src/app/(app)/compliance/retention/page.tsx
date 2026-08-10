import Link from "next/link";
import { notFound } from "next/navigation";

import { getPrivacyRetentionDashboard } from "@vercentlabs/api";

import AppIcon from "@/components/app-icon";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";

export const metadata = { title: "Retention" };
export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

export default async function CompliancePage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.complianceView)) notFound();
  const canManage = hasPermission(session, PERMISSIONS.crmPrivacyManage);

  const dashboard = (await tenantTransaction(session.organizationId as string, (client) =>
    getPrivacyRetentionDashboard(client, crmContext(session)),
  )) as Row;
  const policies = (dashboard.policies || []) as Row[];
  const runs = (dashboard.runs || []) as Row[];

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Governance · Compliance</p>
          <h1>Retention</h1>
          <p>
            Configured retention windows for CRM customer data (leads,
            contacts, business partners) and the immutable evidence log of
            every retention action that has run. This is the real, current
            scope — retention policy is not yet configurable for other
            modules.
          </p>
        </div>
        {canManage ? (
          <Link className="secondary-button" href="/crm/privacy-retention">
            <AppIcon name="settings" size={16} /> Manage policies in CRM
          </Link>
        ) : null}
      </section>

      <section className="dashboard-section" aria-labelledby="retention-policies-title">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Configured policies</p>
            <h2 id="retention-policies-title">Retention policies</h2>
          </div>
        </div>
        <div className="table-panel">
          <table>
            <thead>
              <tr>
                <th scope="col">Subject</th>
                <th scope="col">Name</th>
                <th scope="col">Retention</th>
                <th scope="col">Action</th>
                <th scope="col">Status</th>
                <th scope="col">Last run</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((policy) => (
                <tr key={String(policy.id)}>
                  <td>{String(policy.subject_type)}</td>
                  <td>{String(policy.name)}</td>
                  <td>{String(policy.retention_days)} days</td>
                  <td>{String(policy.action)}</td>
                  <td>
                    <span
                      className={`status-badge ${policy.status === "active" ? "success" : "neutral"}`}
                    >
                      {String(policy.status)}
                    </span>
                  </td>
                  <td>
                    {policy.last_run_at
                      ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(
                          new Date(String(policy.last_run_at)),
                        )
                      : "Never"}
                  </td>
                </tr>
              ))}
              {!policies.length ? (
                <tr>
                  <td colSpan={6}>No retention policies configured.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="dashboard-section" aria-labelledby="retention-evidence-title">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Immutable evidence</p>
            <h2 id="retention-evidence-title">Recent executions</h2>
          </div>
        </div>
        <div className="stack-list">
          {runs.slice(0, 50).map((row) => (
            <div key={String(row.id)}>
              <div>
                <strong>
                  {String(row.subject_type)} · {String(row.operation)}
                </strong>
                <span>
                  {String(row.subject_id)} ·{" "}
                  {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(
                    new Date(String(row.executed_at)),
                  )}
                </span>
              </div>
            </div>
          ))}
          {!runs.length ? (
            <div className="empty-state compact">
              <span className="empty-state-icon" aria-hidden="true">
                <AppIcon name="audit" size={20} />
              </span>
              <div>
                <strong>No retention execution recorded yet</strong>
                <p>Evidence of every retention action will appear here.</p>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
