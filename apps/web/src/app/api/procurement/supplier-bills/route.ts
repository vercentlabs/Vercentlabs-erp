import { createSupplierBill, listSupplierBills } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Supplier bills, newest first, by view, source (purchase_order / direct), document, payment and due status, supplier, order, receipt, expense category, dates and search;
// supplier, order, receipt, dates and search; recording a bill from a purchase order, from goods receipts, or directly for an expense.
const FILTERS = ["view", "source", "documentStatus", "paymentStatus", "due", "supplierId", "purchaseOrderId", "goodsReceiptId", "expenseCategoryId", "matchingResult", "dateFrom", "dateTo", "search"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(FILTERS.map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value));
  return procurementRead(request, async (client, context) => ({ rows: await listSupplierBills(client, context, filters) }), "procurement.bills.view");
}

export async function POST(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await createSupplierBill(client, context, input) }), 201, "procurement.bills.view");
}
