// Point of Sale's app manifest: the apps it cannot work without (switched on with it, and kept on while it is on), the apps it connects to
// through a bridge when both are on, and the open work listed before it is switched off (core/platform/app-manifests.js).
export const manifest = Object.freeze({
  key: "point-of-sale",
  depends: [],
  bridges: ["stock"],
  openWork: [
    { label: "open cashier shifts", sql: `SELECT count(*) AS count FROM tenant.pos_shifts WHERE organization_id = $1 AND status IN ('open', 'closing')` },
  ],
});
