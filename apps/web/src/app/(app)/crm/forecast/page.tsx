import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrmDashboard, getCrmReport } from "@vercentlabs/api";
import { formatMoney } from "@vercentlabs/localization";

import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { crmContext } from "@/modules/crm";

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
        <article>
          <span>Open pipeline</span>
          <strong>{money(pipeline)}</strong>
          <small>{openDeals} active opportunities</small>
        </article>
        <article>
          <span>Weighted forecast</span>
          <strong>{money(weighted)}</strong>
          <small>{coverage}% probability-weighted coverage</small>
        </article>
        <article>
          <span>Won revenue</span>
          <strong>{money(won)}</strong>
          <small>Closed-won revenue in the report scope</small>
        </article>
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

        {rows.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Owner</th>
                  <th>Pipeline</th>
                  <th>Weighted</th>
                  <th>Won</th>
                  <th>Weighted share</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const ownerPipeline = numeric(row.pipeline);
                  const ownerWeighted = numeric(row.weighted);
                  const share = ownerPipeline > 0 ? Math.round((ownerWeighted / ownerPipeline) * 100) : 0;
                  return (
                    <tr key={String(row.owner || "Unassigned")}>
                      <td><strong>{String(row.owner || "Unassigned")}</strong></td>
                      <td>{money(ownerPipeline)}</td>
                      <td>{money(ownerWeighted)}</td>
                      <td>{money(row.won)}</td>
                      <td>{share}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <strong>No forecast data yet</strong>
            <p>Create and value opportunities to build the forecast.</p>
            <Link className="primary-button" href="/crm/opportunities?create=1">Create opportunity</Link>
          </div>
        )}
      </section>
    </div>
  );
}
