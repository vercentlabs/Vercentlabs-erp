import { notFound } from "next/navigation";
import { getAsset } from "@vercentlabs/api";
import AccountingActionButton from "@/modules/accounting/components/accounting-action-button";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { accountingContext } from "@/modules/accounting";
import { tenantTransaction } from "@/core/db";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;
type Detail = {
  asset: Row;
  schedule: Row[];
  transactions: Row[];
  events: Row[];
};

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.accountingView)) return notFound();
  const context = accountingContext(session);
  let data: Detail;
  try {
    data = (await tenantTransaction(context.organizationId, (client) =>
      getAsset(client, context, id),
    )) as unknown as Detail;
  } catch {
    return notFound();
  }
  const asset = data.asset;
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Fixed asset</p>
          <h1>{String(asset.asset_number)}</h1>
          <p>
            {String(asset.name)} · {String(asset.category_name)}
          </p>
        </div>
        <span className="status-badge neutral">{String(asset.status)}</span>
      </section>
      {hasPermission(session, PERMISSIONS.accountingAssetsManage) ? (
        <div className="accounting-action-bar">
          {asset.status === "draft" ? (
            <AccountingActionButton
              endpoint={`/api/accounting/assets/${id}/actions`}
              action="capitalize"
              label="Capitalize asset"
              tone="primary"
            />
          ) : null}
          {["in_service", "fully_depreciated", "suspended"].includes(
            String(asset.status),
          ) ? (
            <AccountingActionButton
              endpoint={`/api/accounting/assets/${id}/actions`}
              action="dispose"
              label="Dispose asset"
              body={{ proceeds: 0, note: "Governed disposal" }}
              tone="danger"
            />
          ) : null}
        </div>
      ) : null}
      <section className="accounting-kpi-grid">
        <article className="metric-card">
          <span>Acquisition cost</span>
          <strong>
            {String(asset.functional_currency_code)}{" "}
            {String(asset.base_acquisition_cost)}
          </strong>
        </article>
        <article className="metric-card">
          <span>Accumulated depreciation</span>
          <strong>
            {String(asset.functional_currency_code)}{" "}
            {String(asset.accumulated_depreciation)}
          </strong>
        </article>
        <article className="metric-card">
          <span>Net book value</span>
          <strong>
            {String(asset.functional_currency_code)}{" "}
            {String(asset.net_book_value)}
          </strong>
        </article>
        <article className="metric-card">
          <span>Useful life</span>
          <strong>{String(asset.useful_life_months)} months</strong>
        </article>
      </section>
      <section className="panel">
        <p className="eyebrow">Depreciation schedule</p>
        <h2>Book plan and postings</h2>
        <div className="accounting-table">
          <div className="accounting-table-row accounting-table-head">
            <span>Sequence</span>
            <span>Date</span>
            <span>Opening</span>
            <span>Depreciation</span>
            <span>Closing</span>
            <span>Status</span>
          </div>
          {data.schedule.map((row) => (
            <div className="accounting-table-row" key={String(row.id)}>
              <span>{String(row.sequence)}</span>
              <span>{String(row.depreciation_date).slice(0, 10)}</span>
              <span>{String(row.opening_book_value)}</span>
              <span>{String(row.depreciation_amount)}</span>
              <span>{String(row.closing_book_value)}</span>
              <span>
                {String(row.status)}
                {row.status === "planned" &&
                hasPermission(session, PERMISSIONS.accountingAssetsManage) ? (
                  <AccountingActionButton
                    endpoint={`/api/accounting/assets/${id}/actions`}
                    action="post_depreciation"
                    label="Post"
                    body={{ scheduleId: row.id }}
                  />
                ) : null}
              </span>
            </div>
          ))}
        </div>
      </section>
      <div className="accounting-two-column">
        <section className="panel">
          <p className="eyebrow">Asset transactions</p>
          <h2>Lifecycle</h2>
          <div className="accounting-list">
            {data.transactions.map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>
                    {String(row.transaction_type).replaceAll("_", " ")}
                  </strong>
                  <small>
                    {String(row.transaction_date).slice(0, 10)} ·{" "}
                    {String(row.note || "")}
                  </small>
                </span>
                <b>{String(row.amount)}</b>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <p className="eyebrow">Audit events</p>
          <h2>Control history</h2>
          <div className="accounting-list">
            {data.events.map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>{String(row.event_type)}</strong>
                  <small>
                    {String(row.from_status || "Created")} →{" "}
                    {String(row.to_status || "Recorded")}
                  </small>
                </span>
                <time>
                  {new Date(String(row.occurred_at)).toLocaleString("en-IN")}
                </time>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
