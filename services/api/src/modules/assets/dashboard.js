// The Assets home dashboard. Value figures need assets.reports.view; everything is organization-wide.
import { need } from "./common.js";
import { canSeeValue } from "./register.js";


export async function getAssetDesk(client, c) {
  need(c, "assets.view");
  const values = [c.organizationId];
  const status = await client.query(`SELECT status,count(*)::int AS n FROM tenant.assets WHERE organization_id=$1 GROUP BY status`, values);
  const counts = Object.fromEntries(status.rows.map((r) => [r.status, r.n]));
  const one = async (sql, extra = []) => (await client.query(sql, [...values, ...extra])).rows[0];
  const out = {
    assetsByStatus: counts,
    totalAssets: status.rows.reduce((s, r) => s + (r.status === "disposed" ? 0 : r.n), 0),
    openWorkOrders: (await one(`SELECT count(*)::int AS n FROM tenant.asset_maintenance_orders WHERE organization_id=$1 AND status IN ('planned','scheduled','in_progress','on_hold')`)).n,
    maintenanceOverdue: (await one(`SELECT count(*)::int AS n FROM tenant.asset_maintenance_plans WHERE organization_id=$1 AND active=true AND next_due_date<current_date`)).n,
    pendingApprovals: (await one(`SELECT ((SELECT count(*) FROM tenant.asset_transfers WHERE organization_id=$1 AND status='submitted')+(SELECT count(*) FROM tenant.asset_disposals WHERE organization_id=$1 AND status='pending_approval')+(SELECT count(*) FROM tenant.asset_depreciation_runs WHERE organization_id=$1 AND status IN ('calculated','approved')))::int AS n`)).n,
  };
  if (canSeeValue(c)) {
    const v = await one(`SELECT COALESCE(sum(net_book_value),0)::text AS nbv,COALESCE(sum(capitalized_cost),0)::text AS cost,COALESCE(sum(accumulated_depreciation),0)::text AS dep FROM tenant.assets WHERE organization_id=$1 AND status NOT IN ('draft','disposed')`);
    out.totalNetBookValue = v.nbv;
    out.totalCost = v.cost;
    out.totalAccumulatedDepreciation = v.dep;
  }
  return out;
}
