import { ProcurementError, transitionProcurementRecord } from "../modules/procurement/index.js";
import { postStockMovement } from "../modules/stock/index.js";

// Posting an approved receipt calls a Stock public contract: Procurement's
// own applyReceiptToOrder() only updates its purchase-order-line
// bookkeeping (received_quantity), so this is what moves Stock's real
// inventory (tenant.stock_balances) — the same pattern as Sales' fulfilment
// path (services/api/src/orchestration/sales-stock-fulfillment.js). Not
// best-effort: a receipt/reversal claims a
// specific physical quantity moved, so the Stock movement must actually
// succeed for the transition to be considered complete, matching Sales'
// documented choice for the same reason.
//
// Only lines carrying a warehouseId are stock-tracked (services/require-only
// lines, or a line missing warehouse master data, are skipped -- the same
// line-level "not a stock-tracked line" convention as
// sales-stock-fulfillment.js).
export async function transitionProcurementReceiptWithStockMovement(
  client,
  procurementContext,
  stockContext,
  receiptId,
  action,
  input = {},
) {
  if (procurementContext.organizationId !== stockContext.organizationId) {
    throw new ProcurementError(
      403,
      "Procurement and Stock organization context must match.",
      "PROCUREMENT_STOCK_CONTEXT_INVALID",
    );
  }

  const result = await transitionProcurementRecord(
    client,
    procurementContext,
    "receipts",
    receiptId,
    action,
    input,
  );

  if (action !== "approve" && action !== "reverse") return result;

  const movementType = action === "approve" ? "receipt" : "issue";
  const lines = Array.isArray(result.lines) ? result.lines : [];
  for (const line of lines) {
    const warehouseId = line.warehouseId || line.warehouse_id || null;
    const itemId = line.itemId || line.item_id || null;
    const acceptedQuantity = Number(line.acceptedQuantity ?? line.accepted_quantity ?? 0);
    if (!warehouseId || !itemId || !(acceptedQuantity > 0)) continue; // not a stock-tracked line
    await postStockMovement(client, stockContext, {
      movementType,
      itemId,
      warehouseId,
      quantity: acceptedQuantity,
      referenceType: "procurement_receipt",
      referenceId: receiptId,
      idempotencyKey: `procurement-receipt:${action}:${receiptId}:${line.id}`,
    });
  }

  return result;
}

