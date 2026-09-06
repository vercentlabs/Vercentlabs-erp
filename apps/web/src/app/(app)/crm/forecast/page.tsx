import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrmDashboard, getCrmReport } from "@vercentlabs/api";
import { formatMoney } from "@vercentlabs/localization";

import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { crmContext } from "@/modules/crm";
import {
  EnterpriseDataGrid,
  MetricCard,
  StatePanel,
  type DataGridColumn,
} from "@/shared/design";

export const metadata = { title: "Sales forecast" };
export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

function numeric(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

export default async function CrmForecastPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmReportsView)) notFound();
  const context = crmContext(session);

  const { dashboard, forecast } = await tenantTransaction(
    context.organizationId,
    async (client) => ({
      dashboard: await getCrmDashboard(client, context),
      forecast: await getCrmReport(client, context, "forecast"),
    }),
  );

  const metrics = dashboard.metrics as Row;
  const rows = forecast.rows as Row[];
  const currency = String(metrics.currencyCode || "INR");
  const money = (value: unknown) =>
    formatMoney(value, { currency, locale: session.locale });

  const pipeline = numeric(metrics.pipelineValue);
  const weighted = numeric(metrics.weightedPipeline);
  const won = rows.reduce((sum, row) => sum + numeric(row.won), 0);
  const openDeals = numeric(metrics.openOpportunities);
  const coverage = pipeline > 0 ? Math.round((weighted / pipeline) * 100) : 0;

  return (
    <div className="crm-forecast-page">
      <section className="page-heading crm-hci-heading">
        <div>
          <p className="eyebrow">CRM · Pipeline</p>
          <h1>Sales forecast</h1>
          <p>
            Probability-weighted revenue by owner, grounded in the same opportunity records and visibility rules as the live pipeline.
          </p>
        </div>
        <Link className="secondary-button" href="/crm/pipeline">
          Open pipeline
        </Link>
      </section>

      <section className="crm-forecast-metrics" aria-label="Forecast summary">
        <MetricCard
          label="Open pipeline"
          value={money(pipeline)}
          hint={`${openDeals} active opportunities`}
        />
        <MetricCard
          label="Weighted forecast"
          value={money(weighted)}
          hint={`${coverage}% probability-weighted coverage`}
        />
        <MetricCard
          label="Won revenue"
          value={money(won)}
          hint="Closed-won revenue in the report scope"
        />
      </section>

      <section className="panel crm-forecast-table">
        <div className="card-title-row">
          <div>
            <p className="eyebrow">Owner forecast</p>
            <h2>Where the weighted revenue sits</h2>
          </div>
          {rows.length ? (
            <a className="link-button" href="/api/crm/reports/forecast?format=csv" download>
              Download CSV
            </a>
          ) : null}
        </div>

        {(() => {
          const columns: DataGridColumn<Row>[] = [
            {
              id: "owner",
              header: "Owner",
              cell: (row) => (
                <strong>{String(row.owner || "Unassigned")}</strong>
              ),
            },
            {
              id: "pipeline",
              header: "Pipeline",
              cell: (row) => money(numeric(row.pipeline)),
            },
            {
              id: "weighted",
              header: "Weighted",
              cell: (row) => money(numeric(row.weighted)),
            },
            {
              id: "won",
              header: "Won",
              cell: (row) => money(row.won),
            },
            {
              id: "share",
              header: "Weighted share",
              cell: (row) => {
                const ownerPipeline = numeric(row.pipeline);
                const ownerWeighted = numeric(row.weighted);
                const share =
                  ownerPipeline > 0
                    ? Math.round((ownerWeighted / ownerPipeline) * 100)
                    : 0;
                return `${share}%`;
              },
            },
          ];
          return (
            <EnterpriseDataGrid
              caption="Owner forecast"
              rows={rows}
              rowKey={(row) => String(row.owner || "Unassigned")}
              columns={columns}
              emptyState={
                <StatePanel
                  title="No forecast data yet"
                  description="Create and value opportunities to build the forecast."
                  action={
                    <Link
                      className="primary-button"
                      href="/crm/opportunities?create=1"
                    >
                      Create opportunity
                    </Link>
                  }
                />
              }
            />
          );
        })()}
      </section>
    </div>
  );
}
