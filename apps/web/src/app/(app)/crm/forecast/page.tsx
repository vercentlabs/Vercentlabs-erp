import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrmDashboard, getCrmReport, getOpportunityRevenueDashboard, getForecastCalibration } from "@vercentlabs/api";
import { formatMoney } from "@vercentlabs/localization";

import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { crmApiContext } from "@/modules/crm";
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
  const context = await crmApiContext(session);

  const { dashboard, forecast, revenue: revenueRaw, calibration } = await tenantTransaction(
    context.organizationId,
    async (client): Promise<{
      dashboard: Record<string, unknown>;
      forecast: Record<string, unknown>;
      revenue: Record<string, unknown> | null;
      calibration: Array<Record<string, unknown>>;
    }> => ({
      dashboard: await getCrmDashboard(client, context),
      forecast: await getCrmReport(client, context, "forecast"),
      // F011 explainable predictive model + F026 deterministic win/loss
      // aggregation — folded into this existing, already-approved Forecast
      // workspace rather than a new standalone page (a prior consolidation
      // pass explicitly retired several single-purpose CRM pages, including
      // an earlier "opportunity-revenue" screen — see
      // crm-lead-experience-contract.test.mjs's retiredScreenFiles list).
      revenue: hasPermission(session, PERMISSIONS.crmOpportunitiesManage)
        ? await getOpportunityRevenueDashboard(client, context)
        : null,
      // Integrity closeout (Prompts 1-5): F011's drift/calibration
      // requirement — a deterministic comparison of each closed period's
      // stored prediction against what actually closed, never a fabricated
      // AI explanation.
      calibration: hasPermission(session, PERMISSIONS.crmOpportunitiesManage)
        ? await getForecastCalibration(client, context, 6)
        : [],
    }),
  );
  const revenue = revenueRaw as {
    latestForecast: Row | null;
    winLoss: { byReason: Record<string, number>; byCompetitor: Record<string, number>; averageCycleDays: number };
  } | null;

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

      {revenue ? (
        <>
          <section className="panel" aria-label="Explainable predictive forecast">
            <div className="card-title-row">
              <div>
                <p className="eyebrow">F011 · Explainable, deterministic model</p>
                <h2>Predictive forecast</h2>
              </div>
            </div>
            {revenue.latestForecast ? (
              <dl className="crm-lead-profile-grid">
                <div><dt>Predicted amount</dt><dd>{money(Number(revenue.latestForecast.predictedAmount || 0))}</dd></div>
                <div><dt>Confidence</dt><dd>{String(revenue.latestForecast.confidencePercent)}%</dd></div>
                <div><dt>Model version</dt><dd>{String(revenue.latestForecast.modelVersion)}</dd></div>
              </dl>
            ) : (
              <StatePanel title="No predictive forecast captured yet." />
            )}
            <p className="field-help">
              A deterministic calculation from stored win-rate, health and activity signals — not an opaque AI score. Each snapshot pins its own model version, so a later model change never reinterprets a historical forecast.
            </p>
          </section>

          <section className="panel" aria-label="Forecast calibration">
            <div className="card-title-row">
              <div>
                <p className="eyebrow">F011 · Drift monitoring</p>
                <h2>Prediction calibration</h2>
              </div>
            </div>
            {calibration.length ? (
              <dl className="crm-lead-profile-grid">
                {calibration.map((period) => {
                  const errorPercent = period.errorPercent as number | null;
                  return (
                    <div key={String(period.periodId)}>
                      <dt>{String(period.periodName)}</dt>
                      <dd>
                        Predicted {money(Number(period.predictedAmount || 0))} · Actual {money(Number(period.actualWonAmount || 0))}
                        {errorPercent == null ? "" : ` · ${errorPercent > 0 ? "+" : ""}${errorPercent}% error`}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            ) : (
              <StatePanel title="No closed forecast period has a captured prediction yet." />
            )}
            <p className="field-help">
              Each row compares a closed period&apos;s own stored prediction (pinned at capture time) against the revenue that actually closed for that same period — a real accuracy check, not a re-estimated or reinterpreted figure.
            </p>
          </section>

          <section className="panel" aria-label="Deterministic win/loss aggregation">
            <div className="card-title-row">
              <div>
                <p className="eyebrow">F026 · Deterministic aggregation</p>
                <h2>Loss analysis</h2>
              </div>
            </div>
            <dl className="crm-lead-profile-grid">
              <div>
                <dt>By reason</dt>
                <dd>
                  {Object.entries(revenue.winLoss.byReason as Record<string, number>).length
                    ? Object.entries(revenue.winLoss.byReason as Record<string, number>)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 5)
                        .map(([reason, count]) => `${reason} (${count})`)
                        .join(", ")
                    : "No closed-deal reviews recorded yet."}
                </dd>
              </div>
              <div>
                <dt>By competitor</dt>
                <dd>
                  {Object.entries(revenue.winLoss.byCompetitor as Record<string, number>).length
                    ? Object.entries(revenue.winLoss.byCompetitor as Record<string, number>)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 5)
                        .map(([name, count]) => `${name} (${count})`)
                        .join(", ")
                    : "No competitor recorded on closed reviews yet."}
                </dd>
              </div>
              <div><dt>Average sales cycle</dt><dd>{String(revenue.winLoss.averageCycleDays)} days</dd></div>
            </dl>
          </section>
        </>
      ) : null}
    </div>
  );
}
