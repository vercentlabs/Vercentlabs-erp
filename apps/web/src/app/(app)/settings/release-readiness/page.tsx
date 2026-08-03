import { getReleaseGovernanceDashboard } from "@vercentlabs/api";
import { notFound } from "next/navigation";

import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";
import { releaseGovernanceContext } from "@/lib/release-governance";

export const dynamic = "force-dynamic";
export const metadata = { title: "Enterprise release readiness" };

type CheckRow = {
  id?: string;
  check_key?: string;
  status?: string;
  source?: string;
  environment?: string;
  completed_at?: string | Date | null;
};

type IncidentRow = {
  id?: string;
  title?: string;
  service?: string;
  severity?: string;
  status?: string;
  owner_name?: string | null;
  next_action_at?: string | Date | null;
};

type SnapshotRow = {
  id?: string;
  environment?: string;
  readiness_status?: string;
  risk_band?: string;
  release_score?: number | string;
  commit_sha?: string | null;
  captured_at?: string | Date;
};

type Dashboard = {
  health?: {
    readiness?: string;
    riskBand?: string;
    score?: number;
    blockers?: string[];
    warnings?: string[];
    metrics?: Record<string, unknown>;
  };
  summary?: Record<string, unknown>;
  checks?: CheckRow[];
  incidents?: IncidentRow[];
  snapshots?: SnapshotRow[];
  benchmarkGate?: { command?: string; status?: string; note?: string };
};

const count = (value: unknown) => Number(value || 0).toLocaleString("en-IN");
const date = (value: unknown) => {
  if (!value) return "Not recorded";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime())
    ? "Not recorded"
    : parsed.toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      });
};

export default async function ReleaseReadinessPage() {
  const session = await requireWorkspace();
  if (
    !hasPermission(session, PERMISSIONS.auditView) &&
    !hasPermission(session, PERMISSIONS.organizationManage)
  ) {
    notFound();
  }

  const context = releaseGovernanceContext(session);
  const data = (await tenantTransaction(context.organizationId, (client) =>
    getReleaseGovernanceDashboard(client, context),
  )) as Dashboard;
  const health = data.health || {};
  const summary = data.summary || {};
  const metrics = health.metrics || {};

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Enterprise release governance</p>
          <h1>Production readiness control tower</h1>
          <p>
            Review executable checks, database readiness, backup and restore
            evidence, deployment smoke results, incidents and immutable release
            snapshots before promoting a build.
          </p>
        </div>
        <span
          className={`status-badge ${health.readiness === "ready" ? "success" : health.readiness === "attention" ? "warning" : "danger"}`}
        >
          {String(health.readiness || "blocked")}
        </span>
      </section>

      <section className="procurement-grid">
        <article className="metric-card">
          <span>Release score</span>
          <strong>{count(health.score)}%</strong>
        </article>
        <article className="metric-card">
          <span>Required checks</span>
          <strong>{count(metrics.requiredChecks)}</strong>
        </article>
        <article className="metric-card">
          <span>Passed checks</span>
          <strong>{count(metrics.passedChecks)}</strong>
        </article>
        <article className="metric-card">
          <span>Missing checks</span>
          <strong>{count(metrics.missingChecks)}</strong>
        </article>
        <article className="metric-card">
          <span>Open incidents</span>
          <strong>{count(summary.openIncidents)}</strong>
        </article>
        <article className="metric-card">
          <span>Verified snapshots</span>
          <strong>{count(summary.snapshots)}</strong>
        </article>
      </section>

      <div className="accounting-two-column">
        <section className="panel">
          <p className="eyebrow">Promotion blockers</p>
          <h2>What must be resolved</h2>
          <div className="accounting-list">
            {(health.blockers || []).map((blocker) => (
              <div key={blocker}>
                <span>
                  <strong>Blocked</strong>
                  <small>{blocker}</small>
                </span>
                <b>High</b>
              </div>
            ))}
            {(health.warnings || []).map((warning) => (
              <div key={warning}>
                <span>
                  <strong>Review</strong>
                  <small>{warning}</small>
                </span>
                <b>Medium</b>
              </div>
            ))}
            {!health.blockers?.length && !health.warnings?.length ? (
              <p>No local release-governance blockers are recorded.</p>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">Truthful benchmark boundary</p>
          <h2>419-capability evidence remains separate</h2>
          <p>{data.benchmarkGate?.note}</p>
          <p>
            Run <code>{data.benchmarkGate?.command}</code> only when every
            benchmark capability has implementation, executable-test and
            acceptance evidence. Stage 11 does not fabricate missing evidence.
          </p>
        </section>
      </div>

      <section className="panel">
        <div className="accounting-section-heading">
          <div>
            <p className="eyebrow">Latest executable evidence</p>
            <h2>Release checks</h2>
          </div>
          <span>{data.checks?.length || 0} latest results</span>
        </div>
        <div className="accounting-table">
          <div className="accounting-table-row accounting-table-head">
            <span>Check</span>
            <span>Status</span>
            <span>Source</span>
            <span>Environment</span>
            <span>Completed</span>
            <span>Evidence</span>
          </div>
          {(data.checks || []).map((row) => (
            <div className="accounting-table-row" key={String(row.id)}>
              <span>
                <strong>{String(row.check_key || "unknown")}</strong>
              </span>
              <span>{String(row.status || "unknown")}</span>
              <span>{String(row.source || "manual")}</span>
              <span>{String(row.environment || "development")}</span>
              <span>{date(row.completed_at)}</span>
              <span>Immutable hash recorded</span>
            </div>
          ))}
          {!data.checks?.length ? (
            <p>No release checks are recorded yet.</p>
          ) : null}
        </div>
      </section>

      <div className="accounting-two-column">
        <section className="panel">
          <p className="eyebrow">Incident ownership</p>
          <h2>Open release incidents</h2>
          <div className="accounting-list">
            {(data.incidents || []).map((incident) => (
              <div key={String(incident.id)}>
                <span>
                  <strong>
                    {String(incident.title || "Release incident")}
                  </strong>
                  <small>
                    {String(incident.service || "platform")} ·{" "}
                    {String(incident.status || "open")} ·{" "}
                    {date(incident.next_action_at)}
                  </small>
                </span>
                <b>{String(incident.severity || "medium")}</b>
              </div>
            ))}
            {!data.incidents?.length ? (
              <p>No unresolved release incidents.</p>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">Immutable evidence</p>
          <h2>Recent readiness snapshots</h2>
          <div className="accounting-list">
            {(data.snapshots || []).slice(0, 10).map((snapshot) => (
              <div key={String(snapshot.id)}>
                <span>
                  <strong>
                    {String(snapshot.environment || "development")} ·{" "}
                    {String(snapshot.readiness_status || "blocked")}
                  </strong>
                  <small>
                    {date(snapshot.captured_at)} ·{" "}
                    {String(snapshot.commit_sha || "commit not supplied")}
                  </small>
                </span>
                <b>{count(snapshot.release_score)}%</b>
              </div>
            ))}
            {!data.snapshots?.length ? (
              <p>No release snapshots are recorded.</p>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}
