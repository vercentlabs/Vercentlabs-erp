import { getProcurementGovernanceDashboard } from "@vercentlabs/api";

import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { procurementContext } from "@/modules/procurement";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown> & {
  health?: {
    readiness?: string;
    riskBand?: string;
    blockers?: string[];
    warnings?: string[];
  };
};
type Dashboard = {
  summary?: Record<string, unknown>;
  suppliers?: Row[];
  requisitions?: Row[];
  sourcingEvents?: Row[];
  purchaseOrders?: Row[];
  receipts?: Row[];
  exceptionCases?: Row[];
};

const count = (value: unknown) => Number(value || 0).toLocaleString("en-IN");
const title = (row: Row) => {
  const data =
    row.data && typeof row.data === "object"
      ? (row.data as Record<string, unknown>)
      : {};
  return String(row.search_text || data.title || data.legalName || row.id);
};

export default async function ProcurementGovernancePage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.procurementView)) {
    return (
      <section className="panel">
        <h1>Procurement access required</h1>
      </section>
    );
  }
  const context = procurementContext(session);
  const data = (await tenantTransaction(context.organizationId, (client) =>
    getProcurementGovernanceDashboard(client, context),
  )) as Dashboard;
  const summary = data.summary || {};
  const priorityRows = [
    ...(data.suppliers || []),
    ...(data.requisitions || []),
    ...(data.sourcingEvents || []),
    ...(data.purchaseOrders || []),
    ...(data.receipts || []),
  ]
    .filter((row) => row.health?.readiness !== "ready")
    .slice(0, 20);

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Source-to-pay governance</p>
          <h1>Supplier, sourcing and purchasing control tower</h1>
          <p>
            Monitor qualification evidence, competitive sourcing, approval SLAs,
            supplier acknowledgement, delivery risk, receiving variance and
            owned exceptions.
          </p>
        </div>
      </section>
      <section className="procurement-grid">
        <article className="metric-card">
          <span>Governed records</span>
          <strong>{count(summary.totalRecords)}</strong>
        </article>
        <article className="metric-card">
          <span>Ready</span>
          <strong>{count(summary.ready)}</strong>
        </article>
        <article className="metric-card">
          <span>Attention</span>
          <strong>{count(summary.attention)}</strong>
        </article>
        <article className="metric-card">
          <span>Blocked</span>
          <strong>{count(summary.blocked)}</strong>
        </article>
        <article className="metric-card">
          <span>High risk</span>
          <strong>{count(summary.highRisk)}</strong>
        </article>
        <article className="metric-card">
          <span>Owned exceptions</span>
          <strong>{count(summary.openExceptions)}</strong>
        </article>
      </section>
      <section className="panel">
        <div className="accounting-section-heading">
          <div>
            <p className="eyebrow">Priority queue</p>
            <h2>Records requiring intervention</h2>
          </div>
          <span>{priorityRows.length} shown</span>
        </div>
        <div className="accounting-table">
          <div className="accounting-table-row accounting-table-head">
            <span>Record</span>
            <span>Status</span>
            <span>Readiness</span>
            <span>Risk</span>
            <span>Primary issue</span>
            <span>Company</span>
          </div>
          {priorityRows.map((row) => (
            <div className="accounting-table-row" key={String(row.id)}>
              <span>
                <strong>{title(row)}</strong>
                <small>{String(row.id)}</small>
              </span>
              <span>{String(row.status || "unknown")}</span>
              <span>{String(row.health?.readiness || "unknown")}</span>
              <span>{String(row.health?.riskBand || "low")}</span>
              <span>
                {String(
                  row.health?.blockers?.[0] ||
                    row.health?.warnings?.[0] ||
                    "Review required",
                )}
              </span>
              <span>{String(row.company_name || "Active company")}</span>
            </div>
          ))}
          {!priorityRows.length ? (
            <p>
              No Procurement governance interventions are currently required.
            </p>
          ) : null}
        </div>
      </section>
      <div className="accounting-two-column">
        <section className="panel">
          <p className="eyebrow">Supplier lifecycle</p>
          <h2>Qualification and compliance</h2>
          <div className="accounting-list">
            {(data.suppliers || []).slice(0, 10).map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>
                    {String(row.legal_name || row.search_text || "Supplier")}
                  </strong>
                  <small>
                    {String(row.status)} · {String(row.health?.readiness)}
                  </small>
                </span>
                <b>{String(row.health?.riskBand)}</b>
              </div>
            ))}
            {!data.suppliers?.length ? (
              <p>No suppliers are registered.</p>
            ) : null}
          </div>
        </section>
        <section className="panel">
          <p className="eyebrow">Exception ownership</p>
          <h2>Open Procurement cases</h2>
          <div className="accounting-list">
            {(data.exceptionCases || []).slice(0, 10).map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>
                    {String(row.entity_type)} · {String(row.reason_code)}
                  </strong>
                  <small>
                    {String(row.company_name || "Company")} ·{" "}
                    {String(row.status)}
                  </small>
                </span>
                <b>{String(row.priority)}</b>
              </div>
            ))}
            {!data.exceptionCases?.length ? (
              <p>No unresolved Procurement exception cases.</p>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}
