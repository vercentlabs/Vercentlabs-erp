import {
  ACCOUNTING_PERMISSIONS,
  AccountingError,
  asDatabaseDecimal,
  decimal,
  event,
  optionalUuid,
  requirePermission,
  requiredText,
  text,
  uuid,
} from "./core.js";
import { abs } from "./money.js";

export async function getVendorBillMatch(client, context, billIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const billId = uuid(billIdValue, "Vendor bill");
  const result = await client.query(
    `SELECT match.*,bill.bill_number,bill.supplier_invoice_number,bill.matching_status,bill.grand_total
     FROM tenant.accounting_vendor_bill_matches match
     JOIN tenant.accounting_vendor_bills bill
       ON bill.organization_id=match.organization_id AND bill.id=match.vendor_bill_id
     WHERE match.organization_id=$1 AND match.vendor_bill_id=$2`,
    [context.organizationId, billId],
  );
  return result.rows[0] || null;
}

export async function evaluateVendorBillMatch(client, context, billIdValue, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.payablesManage);
  const billId = uuid(billIdValue, "Vendor bill");
  const billResult = await client.query(
    `SELECT * FROM tenant.accounting_vendor_bills WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, billId],
  );
  const bill = billResult.rows[0];
  if (!bill) throw new AccountingError(404, "Vendor bill was not found.");
  if (!["draft", "approved"].includes(bill.status)) throw new AccountingError(409, "Only an unposted bill can be matched.");
  if (!context.allowAllCompanies && context.activeCompanyId && bill.company_id !== context.activeCompanyId) {
    throw new AccountingError(403, "Switch to the bill company before matching it.");
  }
  const matchType = ["two_way", "three_way", "manual"].includes(input.matchType) ? input.matchType : "manual";
  const orderedAmount = decimal(input.orderedAmount ?? bill.grand_total);
  const receivedAmount = decimal(input.receivedAmount ?? (matchType === "three_way" ? 0 : bill.grand_total));
  const invoicedAmount = decimal(bill.grand_total);
  const quantityVariance = decimal(input.quantityVariance || 0);
  const toleranceAmount = decimal(input.toleranceAmount || 0);
  if (orderedAmount < 0n || receivedAmount < 0n || toleranceAmount < 0n) throw new AccountingError(400, "Matching amounts cannot be negative.");
  const amountVariance = invoicedAmount - (matchType === "three_way" ? receivedAmount : orderedAmount);
  const exceptions = [];
  if (abs(amountVariance) > toleranceAmount) exceptions.push({ code: "AMOUNT_VARIANCE", variance: asDatabaseDecimal(amountVariance), tolerance: asDatabaseDecimal(toleranceAmount) });
  if (quantityVariance !== 0n) exceptions.push({ code: "QUANTITY_VARIANCE", variance: asDatabaseDecimal(quantityVariance) });
  if (matchType !== "manual" && !input.purchaseOrderId) exceptions.push({ code: "PURCHASE_ORDER_REQUIRED" });
  if (matchType === "three_way" && !input.goodsReceiptId) exceptions.push({ code: "GOODS_RECEIPT_REQUIRED" });
  const status = exceptions.length ? "exception" : "matched";
  const result = await client.query(
    `INSERT INTO tenant.accounting_vendor_bill_matches (
      organization_id,vendor_bill_id,match_type,purchase_order_id,goods_receipt_id,ordered_amount,received_amount,
      invoiced_amount,quantity_variance,amount_variance,tolerance_amount,status,exceptions,matched_by,matched_at,created_by,updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,now(),$14,$14)
     ON CONFLICT (organization_id,vendor_bill_id) DO UPDATE SET
      match_type=EXCLUDED.match_type,purchase_order_id=EXCLUDED.purchase_order_id,goods_receipt_id=EXCLUDED.goods_receipt_id,
      ordered_amount=EXCLUDED.ordered_amount,received_amount=EXCLUDED.received_amount,invoiced_amount=EXCLUDED.invoiced_amount,
      quantity_variance=EXCLUDED.quantity_variance,amount_variance=EXCLUDED.amount_variance,tolerance_amount=EXCLUDED.tolerance_amount,
      status=EXCLUDED.status,exceptions=EXCLUDED.exceptions,matched_by=EXCLUDED.matched_by,matched_at=now(),
      override_reason=NULL,overridden_by=NULL,overridden_at=NULL,updated_by=EXCLUDED.updated_by,updated_at=now()
     RETURNING *`,
    [context.organizationId, bill.id, matchType, optionalUuid(input.purchaseOrderId, "Purchase order"),
      optionalUuid(input.goodsReceiptId, "Goods receipt"), asDatabaseDecimal(orderedAmount), asDatabaseDecimal(receivedAmount),
      asDatabaseDecimal(invoicedAmount), asDatabaseDecimal(quantityVariance), asDatabaseDecimal(amountVariance),
      asDatabaseDecimal(toleranceAmount), status, JSON.stringify(exceptions), context.userId],
  );
  await client.query(`UPDATE tenant.accounting_vendor_bills SET matching_status=$3,updated_by=$4 WHERE organization_id=$1 AND id=$2`, [context.organizationId, bill.id, status, context.userId]);
  await event(client, context, "vendor_bill", bill.id, "accounting.vendor_bill.match_evaluated", bill.matching_status, status, { matchType, exceptions });
  return result.rows[0];
}

export async function overrideVendorBillMatch(client, context, billIdValue, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.journalApprove);
  const billId = uuid(billIdValue, "Vendor bill");
  const reason = requiredText(input.reason, "Matching override reason", 1000);
  const match = await client.query(
    `UPDATE tenant.accounting_vendor_bill_matches SET status='overridden',override_reason=$3,
      overridden_by=$4,overridden_at=now(),updated_by=$4,updated_at=now()
     WHERE organization_id=$1 AND vendor_bill_id=$2 AND status='exception' RETURNING *`,
    [context.organizationId, billId, reason, context.userId],
  );
  if (!match.rows[0]) throw new AccountingError(409, "Only a recorded matching exception can be overridden.");
  await client.query(`UPDATE tenant.accounting_vendor_bills SET matching_status='overridden',updated_by=$3 WHERE organization_id=$1 AND id=$2`, [context.organizationId, billId, context.userId]);
  await event(client, context, "vendor_bill", billId, "accounting.vendor_bill.match_overridden", "exception", "overridden", { reason: text(reason, 1000) });
  return match.rows[0];
}
