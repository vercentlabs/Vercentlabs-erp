import Link from "next/link";
import { notFound } from "next/navigation";

import AppIcon from "@/components/app-icon";
import GovernancePagination from "@/components/governance-pagination";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { redactAuditPayload } from "@/lib/audit/redact";
import {
  AUTOMATION_EVENT_TYPES,
  LIVE_AUTOMATION_EVENT_TYPES,
  listAutomationRules,
  listAutomationRuns,
  getScheduledAutomationStatus,
} from "@/lib/automation";

export const metadata = { title: "Automation" };
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  succeeded: "success",
  failed: "danger",
  skipped: "neutral",
};

export default async function AutomationPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.automationView)) notFound();

  const params = await searchParams;
  const page = Number(params.page || 1);

  const [rules, runs, scheduledStatus] = await Promise.all([
    listAutomationRules(session),
    listAutomationRuns(session, { page, pageSize: 50 }),
    getScheduledAutomationStatus(session),
  ]);
  const scheduledPending = scheduledStatus.jobStatus.find((row) => row.status === "pending")?.count ?? 0;
  const scheduledDead = scheduledStatus.jobStatus.find((row) => row.status === "dead")?.count ?? 0;
  const scheduledCompleted = scheduledStatus.jobStatus.find((row) => row.status === "completed")?.count ?? 0;

  const activeRules = rules.filter((rule) => rule.status === "active");
  const canManageCrm = hasPermission(session, PERMISSIONS.crmAutomationManage);

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Administration · Automation</p>
          <h1>Automation</h1>
          <p>
            Vercentlabs ERP&apos;s only working automation engine today is
            CRM&apos;s rule-based engine (lead/opportunity events → actions).
            A real background worker process now runs a periodic scheduled
            check for overdue activities, but there is still no cross-module
            workflow builder and no automation for any other module yet —
            this workspace shows the real state honestly rather than a
            broader feature that doesn&apos;t exist.
          </p>
        </div>
        {canManageCrm ? (
          <Link className="secondary-button" href="/crm/settings">
            <AppIcon name="settings" size={16} /> Manage rules in CRM settings
          </Link>
        ) : null}
      </section>

      <section className="metric-grid" aria-label="Automation status">
        <article className="metric-card static">
          <span className="metric-icon" aria-hidden="true">
            <AppIcon name="modules" size={21} />
          </span>
          <span className="metric-copy">
            <small>Active rules (CRM)</small>
            <strong>{activeRules.length}</strong>
          </span>
        </article>
        <article className="metric-card static">
          <span className="metric-icon" aria-hidden="true">
            <AppIcon name="audit" size={21} />
          </span>
          <span className="metric-copy">
            <small>Recorded executions</small>
            <strong>{runs.total}</strong>
          </span>
        </article>
        <article className="metric-card static">
          <span className="metric-icon" aria-hidden="true">
            <AppIcon name="approvals" size={21} />
          </span>
          <span className="metric-copy">
            <small>Approval flows</small>
            <strong>Configured per module</strong>
            <span className="metric-note">
              No cross-module approval-chain designer exists — approvals
              remain permission-gated per module.
            </span>
          </span>
        </article>
        <article className="metric-card static">
          <span className="metric-icon" aria-hidden="true">
            <AppIcon name="notifications" size={21} />
          </span>
          <span className="metric-copy">
            <small>Scheduled overdue-activity checks</small>
            <strong>{scheduledCompleted} completed</strong>
            <span className="metric-note">
              {scheduledPending} pending
              {scheduledDead > 0 ? `, ${scheduledDead} failed permanently` : ""}. Only
              this one scheduled job type exists today — there is no
              general per-rule scheduling designer.
            </span>
          </span>
        </article>
      </section>

      <section className="dashboard-section" aria-labelledby="automation-rules-title">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">CRM automation rules</p>
            <h2 id="automation-rules-title">Rules and their triggers</h2>
          </div>
        </div>
        <div className="table-panel">
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Event</th>
                <th scope="col">Sequence</th>
                <th scope="col">Status</th>
                <th scope="col">Trigger live?</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.name}</td>
                  <td>{rule.eventType}</td>
                  <td>{rule.sequence}</td>
                  <td>
                    <span
                      className={`status-badge ${rule.status === "active" ? "success" : "neutral"}`}
                    >
                      {rule.status}
                    </span>
                  </td>
                  <td>
                    {LIVE_AUTOMATION_EVENT_TYPES.has(rule.eventType) ? (
                      <span className="status-badge success">Yes</span>
                    ) : (
                      <span className="status-badge warning">Not yet</span>
                    )}
                  </td>
                </tr>
              ))}
              {!rules.length ? (
                <tr>
                  <td colSpan={5}>No automation rules configured.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="billing-commercial-note">
          Live triggers today: {[...LIVE_AUTOMATION_EVENT_TYPES].join(", ")}
          {" "}(activity.overdue runs on a periodic scheduled check, not
          instantly). Defined but not yet fired by any code path:{" "}
          {AUTOMATION_EVENT_TYPES.filter((type) => !LIVE_AUTOMATION_EVENT_TYPES.has(type)).join(", ")}{" "}
          — the rule editor lets you configure these, but they are missing
          call sites in CRM&apos;s own mutation code, not a scheduling gap;
          a real background worker now exists and could run them once that
          code is added.
        </p>
      </section>

      <section className="dashboard-section" aria-labelledby="automation-runs-title">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Execution history</p>
            <h2 id="automation-runs-title">Recent runs</h2>
          </div>
        </div>
        <div className="table-panel">
          <table>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Rule</th>
                <th scope="col">Event</th>
                <th scope="col">Entity</th>
                <th scope="col">Status</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {runs.rows.map((run) => (
                <tr key={run.id}>
                  <td>
                    {new Intl.DateTimeFormat("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(run.started_at)}
                  </td>
                  <td>{run.rule_name || "—"}</td>
                  <td>{run.event_type}</td>
                  <td>
                    {run.entity_type} · {run.entity_id}
                  </td>
                  <td>
                    <span className={`status-badge ${STATUS_TONE[run.status] || "neutral"}`}>
                      {run.status}
                    </span>
                  </td>
                  <td>
                    {run.status === "failed" && run.error_message ? (
                      <details className="audit-event-detail">
                        <summary>View</summary>
                        <p className="audit-event-detail-label">Error</p>
                        <pre>{JSON.stringify(redactAuditPayload(run.error_message), null, 2)}</pre>
                        <p className="audit-event-detail-label">Result</p>
                        <pre>{JSON.stringify(redactAuditPayload(run.result), null, 2)}</pre>
                      </details>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
              {!runs.rows.length ? (
                <tr>
                  <td colSpan={6}>No automation executions recorded yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <GovernancePagination
          page={runs.page}
          pageSize={runs.pageSize}
          total={runs.total}
          basePath="/automation"
        />
      </section>
    </>
  );
}
