// Server-side record lookups the Sales routes need before calling a domain
// operation: the owning company of a document (so a cross-module Stock
// context is built from server records, never from the request) and the
// lineage of an amended order version. Always inside the caller's
// organisation-context transaction.
import { SalesError } from "./index.js";

async function companyOf(client, text, values, missing) {
  const result = await client.query(text, values);
  if (!result.rows[0]) throw new SalesError(404, missing, "NOT_FOUND");
  return String(result.rows[0].company_id);
}

export function salesOrderCompanyId(client, organizationId, orderId) {
  return companyOf(client, `SELECT company_id FROM tenant.sales_orders WHERE organization_id=$1 AND id=$2`, [organizationId, orderId], "Sales order not found.");
}

export function salesFulfillmentRequestCompanyId(client, organizationId, requestId) {
  return companyOf(
    client,
    `SELECT sales_order.company_id FROM tenant.sales_fulfillment_requests request JOIN tenant.sales_orders sales_order ON sales_order.id=request.sales_order_id WHERE request.organization_id=$1 AND request.id=$2`,
    [organizationId, requestId],
    "Fulfilment request not found.",
  );
}

export function salesReturnRequestCompanyId(client, organizationId, returnId) {
  return companyOf(
    client,
    `SELECT orders.company_id FROM tenant.sales_return_requests request JOIN tenant.sales_orders orders ON orders.id=request.sales_order_id WHERE request.organization_id=$1 AND request.id=$2`,
    [organizationId, returnId],
    "Return request not found.",
  );
}

// An order version is an *amendment* if an amendment row points at it. In that
// case approving/rejecting it must go through the amendment functions, with the
// version being replaced and the status to resume taken from server records --
// never from the request -- so a caller cannot forge lineage.
export async function salesOrderAmendmentLineage(client, organizationId, orderId, orderVersionId) {
  const amendment = await client.query(
    `SELECT from_version_id FROM tenant.sales_order_amendments WHERE organization_id=$1 AND sales_order_id=$2 AND to_version_id=$3`,
    [organizationId, orderId, orderVersionId],
  );
  const from = amendment.rows[0]?.from_version_id;
  if (!from) return null;
  const submitted = await client.query(
    `SELECT metadata->>'resumeStatus' AS resume_status FROM tenant.sales_document_events WHERE organization_id=$1 AND entity_type='sales_order' AND entity_id=$2 AND event_type='sales_order.amendment_submitted' AND metadata->>'toVersionId'=$3 ORDER BY occurred_at DESC LIMIT 1`,
    [organizationId, orderId, orderVersionId],
  );
  const resumeStatus = submitted.rows[0]?.resume_status === "on_hold" ? "on_hold" : "confirmed";
  return { previousVersionId: String(from), resumeStatus };
}
