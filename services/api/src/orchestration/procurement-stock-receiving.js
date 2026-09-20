import { ProcurementError, transitionProcurementRecord } from "../modules/procurement/index.js";
import { postStockMovement } from "../modules/stock/index.js";

// docs/04-cross-module/PROCUREMENT_TO_STOCK_RECEIVING.md requires that
// "posting an approved receipt calls a Stock public contract" -- Procurement's
// own applyReceiptToOrder() only ever updated its own purchase-order-line
// bookkeeping (received_quantity), never Stock's real inventory. Approving a
// GRN therefore had zero effect on tenant.stock_balances. This is the same
// class of gap Sales found and fixed for its own fulfilment path
// (services/api/src/orchestration/sales-stock-fulfillment.js) -- Procurement
// had not been fixed until now. Not best-effort: a receipt/reversal claims a
// specific physical quantity moved, so the Stock movement must actually
// succeed for the transition to be considered complete, matching Sales'
// documented choice for the same reason.
//
// Only lines carrying a warehouseId are stock-tracked (services/require-only
// lines, or a line missing warehouse master data, are skipped -- matching
// the constitution's own line-level "not a stock-tracked line" convention
// already used by sales-stock-fulfillment.js).
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
  if (result.company_id && result.company_id !== stockContext.companyId) {
    throw new ProcurementError(
      409,
      "The receipt and Stock active company must match.",
      "PROCUREMENT_STOCK_COMPANY_MISMATCH",
    );
  }

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

// F083 gap: a purchase return moved through submit/approve/dispatch/close as pure
// Procurement bookkeeping -- dispatching goods back to the supplier never took them
// out of stock, so on-hand stayed overstated. Dispatch is the moment the goods leave;
// like receiving, the Stock movement is NOT best-effort (insufficient stock blocks the
// dispatch and rolls the whole transaction back).
export async function transitionProcurementReturnWithStockMovement(client, procurementContext, stockContext, returnId, action, input = {}) {
  if (procurementContext.organizationId !== stockContext.organizationId) {
    throw new ProcurementError(403, "Procurement and Stock organization context must match.", "PROCUREMENT_STOCK_CONTEXT_INVALID");
  }
  const result = await transitionProcurementRecord(client, procurementContext, "returns", returnId, action, input);
  if (action !== "dispatch") return result;
  if (result.company_id && result.company_id !== stockContext.companyId) {
    throw new ProcurementError(409, "The return and Stock active company must match.", "PROCUREMENT_STOCK_COMPANY_MISMATCH");
  }
  const lines = Array.isArray(result.lines) ? result.lines : [];
  for (const line of lines) {
    const warehouseId = line.warehouseId || line.warehouse_id || null;
    const itemId = line.itemId || line.item_id || null;
    const quantity = Number(line.quantity ?? 0);
    if (!warehouseId || !itemId || !(quantity > 0)) continue; // not a stock-tracked line
    await postStockMovement(client, stockContext, {
      movementType: "issue",
      itemId,
      warehouseId,
      quantity,
      referenceType: "procurement_return",
      referenceId: returnId,
      idempotencyKey: `procurement-return:dispatch:${returnId}:${line.id}`,
    });
  }
  return result;
}
