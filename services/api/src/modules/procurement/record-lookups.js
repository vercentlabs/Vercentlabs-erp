// The owning company of a Procurement document, read from the server record
// so a cross-module (Stock/Accounting) context is never built from the
// request. Returns null when the record does not exist: the domain operation
// that follows reports the not-found in its own terms.
const TABLES = Object.freeze({
  receipts: "procurement_receipts",
  returns: "procurement_returns",
  "purchase-orders": "procurement_purchase_orders",
});

export async function procurementRecordCompanyId(client, organizationId, resource, id) {
  const table = TABLES[resource];
  if (!table) throw new TypeError(`procurementRecordCompanyId: unsupported resource ${resource}`);
  const result = await client.query(`SELECT company_id FROM tenant.${table} WHERE organization_id=$1 AND id=$2`, [organizationId, id]);
  return result.rows[0]?.company_id ? String(result.rows[0].company_id) : null;
}
