import {
  getAccountingReport,
  getTaxReportingGovernanceDashboard,
} from "@vercentlabs/api";

import { accountingContext } from "@/lib/accounting";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;
type Governance = { reportingSnapshots?: Row[] };

export default async function AccountingReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string; from?: string; to?: string }>;
}) {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.accountingReportsView)) {
    return (
      <section className="panel">
        <h1>Accounting report permission required</h1>
      </section>
    );
  }

  const params = await searchParams;
  const report = params.report || "trial-balance";
  const context = accountingContext(session);
  const data = (await tenantTransaction(
    context.organizationId,
    async (client) => ({
      rows: await getAccountingReport(client, context, report, {
        from: params.from,
        to: params.to,
      }),
      governance: await getTaxReportingGovernanceDashboard(client, context),
    }),
  )) as { rows: Row[]; governance: Governance };
  const rows = data.rows;
  const reports = [
    "trial-balance",
    "general-ledger",
    "journal-register",
    "profit-and-loss",
    "balance-sheet",
    "cash-flow",
    "aged-receivables",
    "aged-payables",
    "customer-statement",
    "supplier-statement",
    "tax-summary",
    "bank-reconciliation",
    "budget-vs-actual",
    "cash-flow-forecast",
    "foreign-currency-exposure",
    "close-status",
    "subledger-reconciliation",
  ];
  const columns = rows.length ? Object.keys(rows[0]).slice(0, 8) : [];

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Financial intelligence and evidence</p>
          <h1>Accounting reports</h1>
          <p>
            Generate financial statements from posted, balanced and
            period-controlled ledger lines, then preserve governed reporting
            snapshots for close and audit evidence.
          </p>
        </div>
      </section>

      <section className="panel">
        <form className="accounting-report-controls">
          <label>
            Report
            <select name="report" defaultValue={report}>
              {reports.map((key) => (
                <option key={key} value={key}>
                  {key.replaceAll("-", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input type="date" name="from" defaultValue={params.from} />
          </label>
          <label>
            To
            <input type="date" name="to" defaultValue={params.to} />
          </label>
          <button className="primary-button" type="submit">
            Run report
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="accounting-section-heading">
          <div>
            <p className="eyebrow">Report output</p>
            <h2>{report.replaceAll("-", " ")}</h2>
          </div>
          <span>{rows.length} rows</span>
        </div>
        {rows.length ? (
          <div className="accounting-report-table">
            <div className="accounting-report-row accounting-report-head">
              {columns.map((column) => (
                <span key={column}>{column.replaceAll("_", " ")}</span>
              ))}
            </div>
            {rows.map((row, index) => (
              <div
                className="accounting-report-row"
                key={String(row.id || row.code || row.party_id || index)}
              >
                {columns.map((column) => (
                  <span key={column}>{String(row[column] ?? "")}</span>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <p>No posted accounting data matches the selected report period.</p>
        )}
      </section>

      <section className="panel">
        <div className="accounting-section-heading">
          <div>
            <p className="eyebrow">Immutable reporting evidence</p>
            <h2>Latest governed snapshots</h2>
          </div>
          <span>
            {data.governance.reportingSnapshots?.length || 0} retained
          </span>
        </div>
        <div className="accounting-list">
          {(data.governance.reportingSnapshots || [])
            .slice(0, 12)
            .map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>
                    {String(row.report_type).replaceAll("-", " ")} ·{" "}
                    {String(row.company_name)}
                  </strong>
                  <small>
                    {String(row.period_name || row.as_of_date)} ·{" "}
                    {String(row.row_count)} rows · hash{" "}
                    {String(row.content_hash).slice(0, 12)}
                  </small>
                </span>
                <b>{String(row.readiness_status)}</b>
              </div>
            ))}
          {!data.governance.reportingSnapshots?.length ? (
            <p>
              No reporting snapshots have been captured. Use the governed tax
              operations API during review or period close to preserve one.
            </p>
          ) : null}
        </div>
      </section>
    </>
  );
}
