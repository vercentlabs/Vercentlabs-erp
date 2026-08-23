import Link from "next/link";
import { listAssetCategories, listAssets } from "@vercentlabs/api";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { accountingContext } from "@/modules/accounting";
import { tenantTransaction } from "@/core/db";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;

export default async function AssetsPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.accountingView))
    return (
      <section className="panel">
        <h1>Accounting access required</h1>
      </section>
    );
  const context = accountingContext(session);
  const data = (await tenantTransaction(
    context.organizationId,
    async (client) => ({
      assets: await listAssets(client, context),
      categories: await listAssetCategories(client, context),
    }),
  )) as { assets: Row[]; categories: Row[] };
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Fixed assets</p>
          <h1>Asset register and depreciation</h1>
          <p>
            Capitalize assets, generate book schedules, post depreciation and
            preserve disposal history.
          </p>
        </div>
        {hasPermission(session, PERMISSIONS.accountingAssetsManage) ? (
          <Link className="primary-button" href="/accounting/assets/new">
            New asset
          </Link>
        ) : null}
      </section>
      <section className="accounting-kpi-grid">
        <article className="metric-card">
          <span>Registered assets</span>
          <strong>{data.assets.length}</strong>
        </article>
        <article className="metric-card">
          <span>Asset categories</span>
          <strong>{data.categories.length}</strong>
        </article>
        <article className="metric-card">
          <span>In service</span>
          <strong>
            {data.assets.filter((row) => row.status === "in_service").length}
          </strong>
        </article>
        <article className="metric-card">
          <span>Draft assets</span>
          <strong>
            {data.assets.filter((row) => row.status === "draft").length}
          </strong>
        </article>
      </section>
      <section className="panel">
        <div className="accounting-table">
          <div className="accounting-table-row accounting-table-head">
            <span>Asset</span>
            <span>Category</span>
            <span>Acquired</span>
            <span>Status</span>
            <span>Cost</span>
            <span>Net book value</span>
          </div>
          {data.assets.map((row) => (
            <Link
              className="accounting-table-row"
              href={`/accounting/assets/${String(row.id)}`}
              key={String(row.id)}
            >
              <span>
                <strong>{String(row.asset_number)}</strong>
                <small>{String(row.name)}</small>
              </span>
              <span>{String(row.category_name)}</span>
              <span>{String(row.acquisition_date).slice(0, 10)}</span>
              <span className="status-badge neutral">{String(row.status)}</span>
              <span>
                {String(row.functional_currency_code)}{" "}
                {String(row.base_acquisition_cost)}
              </span>
              <span>
                {String(row.functional_currency_code)}{" "}
                {String(row.net_book_value)}
              </span>
            </Link>
          ))}
          {!data.assets.length ? <p>No fixed assets exist yet.</p> : null}
        </div>
      </section>
      <section className="panel">
        <p className="eyebrow">Categories</p>
        <h2>Accounting policies</h2>
        <div className="accounting-list">
          {data.categories.map((row) => (
            <div key={String(row.id)}>
              <span>
                <strong>
                  {String(row.code)} · {String(row.name)}
                </strong>
                <small>
                  {String(row.default_method).replaceAll("_", " ")} ·{" "}
                  {String(row.default_useful_life_months)} months
                </small>
              </span>
              <b>
                {String(row.asset_account_code)} /{" "}
                {String(row.accumulated_account_code)}
              </b>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
