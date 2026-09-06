import { getCrmReport } from "@vercentlabs/api";
import { notFound } from "next/navigation";

import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { crmContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { CRM_REPORT_KEYS } from "@/modules/crm/scope";
import { EnterpriseDataGrid, StatePanel, type DataGridColumn } from "@/shared/design";

type ReportRow = Record<string, unknown>;

export const metadata = { title: "CRM reports" };
export const dynamic = "force-dynamic";

const REPORT_META = {
  pipeline: ["Pipeline by stage", "Opportunity volume, value and probability-weighted value by sales stage."],
  conversion: ["Lead conversion", "Monthly lead volume and conversion rate into the governed CRM conversion flow."],
  sources: ["Lead source performance", "Lead and conversion volume by source, including won revenue attribution."],
  activities: ["Activity execution", "Calls, meetings, tasks and follow-ups with completion and overdue counts."],
  forecast: ["Sales forecast", "Pipeline, weighted value and won revenue by owner."],
} as const;

const title = (value: string) =>
  value
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase());

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number")
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
  return String(value).replaceAll("_", " ");
}

export default async function CrmReportsPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmReportsView)) notFound();
  const context = crmContext(session);

  const reports = await tenantTransaction(context.organizationId, async (client) => {
    const entries = [];
    for (const name of CRM_REPORT_KEYS) {
      entries.push([name, await getCrmReport(client, context, name)]);
    }
    return Object.fromEntries(entries) as Record<string, { rows: Array<Record<string, unknown>> }>;
  });

  return (
    <div className="crm-reports-page">
      <section className="page-heading crm-hci-heading">
        <div>
          <p className="eyebrow">CRM · Analytics</p>
          <h1>CRM reports</h1>
          <p>
            Five decision-oriented reports for the thirty-feature CRM. Advanced partner, AI, privacy and revenue-operations reports are intentionally outside this product scope.
          </p>
        </div>
        <span className="status-badge neutral">Live tenant data</span>
      </section>

      <div className="crm-report-grid crm-report-grid--core">
        {CRM_REPORT_KEYS.map((name) => {
          const rows = reports[name]?.rows || [];
          const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
          const [reportTitle, description] = REPORT_META[name];
          return (
            <section className="panel crm-report-card" key={name}>
              <div className="card-title-row">
                <div>
                  <p className="eyebrow">Report</p>
                  <h2>{reportTitle}</h2>
                  <p>{description}</p>
                </div>
                {rows.length ? (
                  <a className="link-button" download href={`/api/crm/reports/${name}?format=csv`}>
                    Download CSV
                  </a>
                ) : null}
              </div>
              {(() => {
                const gridColumns: DataGridColumn<ReportRow>[] = columns.map(
                  (column) => ({
                    id: column,
                    header: title(column),
                    cell: (row) => displayValue(row[column]),
                  }),
                );
                return (
                  <EnterpriseDataGrid
                    caption={reportTitle}
                    rows={rows}
                    rowKey={(row, index) => String(row.id ?? index)}
                    columns={gridColumns}
                    emptyState={
                      <StatePanel
                        title="No report data yet"
                        description="This report populates automatically from scoped CRM activity."
                      />
                    }
                  />
                );
              })()}
            </section>
          );
        })}
      </div>
    </div>
  );
}
