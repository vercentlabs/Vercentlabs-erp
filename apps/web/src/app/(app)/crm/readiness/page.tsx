import Link from "next/link";
import {
  crmCoreAcceptanceContext,
  getCrmCoreAcceptanceDashboard,
} from "@vercentlabs/api";
import { notFound } from "next/navigation";

import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "CRM core acceptance" };

type CheckRow = {
  id?: string;
  check_key?: string;
  status?: string;
  source?: string;
  environment?: string;
  completed_at?: string | Date | null;
};

type SnapshotRow = {
  id?: string;
  readiness_status?: string;
  acceptance_score?: string | number;
  commit_sha?: string | null;
  captured_at?: string | Date | null;
};

type Dashboard = {
  health?: {
    readiness?: string;
    score?: number;
    blockers?: string[];
    warnings?: string[];
    metrics?: Record<string, unknown>;
  };
  checks?: CheckRow[];
  snapshots?: SnapshotRow[];
  capabilityIds?: string[];
  surfaceChecks?: string[];
  completionGate?: { command?: string; note?: string };
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

export default async function CrmCoreReadinessPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) notFound();

  const context = crmCoreAcceptanceContext(session);
  const data = (await tenantTransaction(context.organizationId, (client) =>
    getCrmCoreAcceptanceDashboard(client, context),
  )) as Dashboard;
  const health = data.health || {};
  const metrics = health.metrics || {};
  const latest = new Map(
    (data.checks || []).map((row) => [row.check_key, row]),
  );

  return (
    <div className="module-workbench crm-workbench">
      <section className="page-heading">
        <div>
          <p className="eyebrow">CRM-01 · Core acceptance</p>
          <h1>Core CRM completion control tower</h1>
          <p>
            Fail-closed acceptance evidence for account planning, customer
            records, activities, campaigns, privacy, lead operations,
            forecasting, pipelines, playbooks, territories and quotas.
          </p>
        </div>
        <span
          className={`status-badge ${
            health.readiness === "ready"
              ? "success"
              : health.readiness === "attention"
                ? "warning"
                : "danger"
          }`}
        >
          {String(health.readiness || "blocked")}
        </span>
      </section>

      <section className="procurement-grid">
        <article className="metric-card">
          <span>Acceptance score</span>
          <strong>{count(health.score)}%</strong>
        </article>
        <article className="metric-card">
          <span>Core capabilities</span>
          <strong>{count(metrics.capabilityChecks)}</strong>
        </article>
        <article className="metric-card">
          <span>Surface gates</span>
          <strong>{count(metrics.surfaceChecks)}</strong>
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
          <span>Snapshots</span>
          <strong>{count(data.snapshots?.length)}</strong>
        </article>
      </section>

      <div className="accounting-two-column">
        <section className="panel">
          <p className="eyebrow">Acceptance blockers</p>
          <h2>What prevents CRM-01 completion</h2>
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
              <p>All CRM-01 acceptance checks are passing.</p>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">Completion boundary</p>
          <h2>17 core capabilities only</h2>
          <p>{data.completionGate?.note}</p>
          <p>
            Run <code>{data.completionGate?.command}</code> to verify source,
            executable tests and the signed local acceptance ledger for CRM-010
            through CRM-026.
          </p>
          <Link
            className="secondary-button"
            href="/crm/readiness/account-intelligence"
          >
            Open CRM-02 readiness
          </Link>
        </section>
      </div>

      <section className="panel">
        <div className="accounting-section-heading">
          <div>
            <p className="eyebrow">Capability evidence</p>
            <h2>CRM-010 through CRM-026</h2>
          </div>
          <span>{data.capabilityIds?.length || 0} capabilities</span>
        </div>
        <div className="accounting-table">
          <div className="accounting-table-row accounting-table-head">
            <span>Capability</span>
            <span>Status</span>
            <span>Source</span>
            <span>Environment</span>
            <span>Completed</span>
            <span>Evidence</span>
          </div>
          {(data.capabilityIds || []).map((capabilityId) => {
            const row = latest.get(capabilityId);
            return (
              <div className="accounting-table-row" key={capabilityId}>
                <span>
                  <strong>{capabilityId}</strong>
                </span>
                <span>{String(row?.status || "missing")}</span>
                <span>{String(row?.source || "not recorded")}</span>
                <span>{String(row?.environment || "not recorded")}</span>
                <span>{date(row?.completed_at)}</span>
                <span>{row ? "Immutable hash recorded" : "Required"}</span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="accounting-two-column">
        <section className="panel">
          <p className="eyebrow">Cross-surface acceptance</p>
          <h2>Web, mobile, API and platform gates</h2>
          <div className="accounting-list">
            {(data.surfaceChecks || []).map((checkKey) => {
              const row = latest.get(checkKey);
              return (
                <div key={checkKey}>
                  <span>
                    <strong>{checkKey.replace("surface:", "")}</strong>
                    <small>{date(row?.completed_at)}</small>
                  </span>
                  <b>{String(row?.status || "missing")}</b>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">Immutable evidence</p>
          <h2>Recent acceptance snapshots</h2>
          <div className="accounting-list">
            {(data.snapshots || []).slice(0, 10).map((snapshot) => (
              <div key={String(snapshot.id)}>
                <span>
                  <strong>
                    {String(snapshot.readiness_status || "blocked")}
                  </strong>
                  <small>
                    {date(snapshot.captured_at)} ·{" "}
                    {String(snapshot.commit_sha || "commit not supplied")}
                  </small>
                </span>
                <b>{count(snapshot.acceptance_score)}%</b>
              </div>
            ))}
            {!data.snapshots?.length ? (
              <p>No acceptance snapshots recorded.</p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
