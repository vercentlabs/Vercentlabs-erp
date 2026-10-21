// Sales's app manifest: the apps it cannot work without (switched on with it, and kept on while it is on), the apps it connects to
// through a bridge when both are on, and the open work listed before it is switched off (core/platform/app-manifests.js).
export const manifest = Object.freeze({
  key: "sales",
  depends: [],
  bridges: ["stock", "manufacturing", "projects", "quality"],
  openWork: [
    { label: "sales orders not fully invoiced", sql: `SELECT count(*) AS count FROM tenant.sales_orders WHERE organization_id = $1 AND billing_status IN ('ready', 'partially_invoiced')` },
  ],
});
