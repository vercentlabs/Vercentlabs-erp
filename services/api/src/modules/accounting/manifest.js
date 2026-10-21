// Accounting's app manifest: the apps it cannot work without (switched on with it, and kept on while it is on), the apps it connects to
// through a bridge when both are on, and the open work listed before it is switched off (core/platform/app-manifests.js).
export const manifest = Object.freeze({
  key: "accounting",
  depends: [],
  bridges: [],
  openWork: [
    { label: "unposted invoices and bills", sql: `SELECT (SELECT count(*) FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND status IN ('draft', 'pending_approval', 'approved')) + (SELECT count(*) FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND status IN ('draft', 'pending_approval', 'approved')) AS count` },
  ],
});
