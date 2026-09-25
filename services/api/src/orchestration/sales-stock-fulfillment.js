import { SalesError } from "../modules/sales/index.js";
import { completeFulfillmentRequest, completeSalesReturnRequest } from "../modules/sales/index.js";
import { postStockMovement } from "../modules/stock/index.js";
import { consumeSalesOrderReservation } from "./sales-stock-reservation.js";

// F047 gap: completeFulfillmentRequest only ever updated Sales' own
// sales_order_line_progress.fulfilled_quantity counters - it never issued
// real stock, so a warehouse "completing" a fulfilment never decremented
// tenant.stock_balances at all. Unlike the CRM-sync/commission-accrual
// best-effort steps in sales-crm-opportunity-sync.js, a Stock movement here
// is NOT best-effort: insufficient physical stock must block the
// fulfilment from completing (the same way postStockMovement already
// blocks a plain issue with allow_negative_stock off), so a Stock failure
// is left to propagate and roll back the whole transaction.
export async function completeFulfillmentRequestWithStockMovement(
  client,
  salesContext,
  stockContext,
  requestId,
  input = {},
) {
  const lineInputs = Array.isArray(input.lines) ? input.lines : [];
  const lineIds = lineInputs
    .map((line) => line.salesOrderLineId)
    .filter(Boolean);
  const lineContext = new Map();
  if (lineIds.length) {
    const found = await client.query(
      `SELECT line.id, line.item_id, line.warehouse_id, line.conversion_factor, sales_order.id AS order_id, sales_order.company_id
         FROM tenant.sales_order_lines line
         JOIN tenant.sales_order_versions version ON version.id = line.sales_order_version_id
         JOIN tenant.sales_orders sales_order ON sales_order.id = version.sales_order_id
        WHERE line.organization_id = $1 AND line.id = ANY($2::uuid[])`,
      [salesContext.organizationId, lineIds],
    );
    for (const row of found.rows) lineContext.set(String(row.id), row);
  }
  for (const row of lineContext.values()) {
    if (row.warehouse_id && row.company_id !== stockContext.companyId) {
      throw new SalesError(
        409,
        "Sales and Stock active-company context must match.",
        "SALES_STOCK_COMPANY_MISMATCH",
      );
    }
  }

  const result = await completeFulfillmentRequest(
    client,
    salesContext,
    requestId,
    input,
  );

  for (const lineInput of lineInputs) {
    const line = lineContext.get(String(lineInput.salesOrderLineId));
    if (!line || !line.warehouse_id) continue; // not a stock-tracked line
    // Shipped quantity is in the selling unit; Stock issues base units.
    const baseQuantity = Number(lineInput.fulfilledQuantity) * (Number(line.conversion_factor) || 1);
    const consumed = await consumeSalesOrderReservation(client, stockContext, {
      orderId: line.order_id,
      itemId: line.item_id,
      warehouseId: line.warehouse_id,
      baseQuantity,
      requestId,
    });
    if (consumed > 0)
      await client.query(
        `UPDATE tenant.sales_order_line_progress SET reserved_quantity=greatest(reserved_quantity-$3,0),updated_at=now()
          WHERE organization_id=$1 AND sales_order_line_id=$2`,
        [salesContext.organizationId, line.id, consumed / (Number(line.conversion_factor) || 1)],
      );
    await postStockMovement(client, stockContext, {
      movementType: "issue",
      itemId: line.item_id,
      warehouseId: line.warehouse_id,
      quantity: baseQuantity,
      referenceType: "sales_fulfillment_request",
      referenceId: requestId,
      idempotencyKey: `sales-fulfillment:${requestId}:${lineInput.salesOrderLineId}`,
    });
  }

  return result;
}

// F054: receiving a return. Sales records the returned quantity and each
// line's disposition; restocked lines go back into their warehouse through a
// Stock receipt (base units), scrapped lines do not touch stock. One
// transaction, so a Stock failure rolls the whole receipt back.
export async function completeSalesReturnWithStock(client, salesContext, stockContext, returnId, input = {}) {
  const result = await completeSalesReturnRequest(client, salesContext, returnId, input);
  for (const line of result.restock || []) {
    await postStockMovement(client, stockContext, {
      movementType: "receipt",
      itemId: line.itemId,
      warehouseId: line.warehouseId,
      quantity: line.baseQuantity,
      referenceType: "sales_return_request",
      referenceId: returnId,
      idempotencyKey: `sales-return:${returnId}:${line.salesOrderLineId}`,
    });
  }
  return result;
}
