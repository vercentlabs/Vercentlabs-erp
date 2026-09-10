import { getCrmReport } from "@vercentlabs/api";
import { notFound } from "next/navigation";

import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { CRM_REPORT_KEYS } from "@/modules/crm/crm-data-operations-and-customization/capability-registry";
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
  "revenue-operations": ["Revenue operations", "Quota, pipeline coverage, attainment, win rate and sales-cycle performance by owner."],
  "pipeline-intelligence": ["Pipeline health", "Opportunity health, stage age, activity recency and slipped close-date signals."],
  "engagement-intelligence": ["Engagement intelligence", "Conversation volume, risk signals, next actions and review workload by channel."],
  "relationship-coverage": ["Relationship coverage", "Buying-committee coverage, economic buyers, champions and detractor signals."],
  campaigns: ["Campaign performance", "Campaign members, responses, conversions, budget and actual cost."],
  "account-health": ["Account health", "Account tier, lifecycle, health score, revenue potential and review timing."],
  "partner-pipeline": ["Partner pipeline", "Registered partner deals, expected value and won/active deal counts."],
  privacy: ["Privacy operations", "Privacy-request workload, status and overdue obligations."],
  "ai-governance": ["AI governance", "Prediction volume, providers/models and reviewed feedback outcomes."],
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
  const context = await crmApiContext(session);

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
            Governed CRM insight library covering pipeline, conversion, activity, revenue operations, engagement, relationships, privacy and AI oversight. Each report uses the same tenant and record-scope controls as operational CRM.
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
