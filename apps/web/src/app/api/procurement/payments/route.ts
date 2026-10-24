import { listSupplierPayments, paySupplierBills } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { sendAdviceForPayments } from "@/features/procurement/payments/server/advice";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Supplier Payments (Procurement plan Phase 1): payments made to suppliers, read from Finance's records, by view, supplier, method, dates and
// search; "Pay selected" from Payables — one payment per supplier through Finance's approval policy.
const FILTERS = ["limit", "offset", "view", "supplierId", "method", "dateFrom", "dateTo", "search"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(FILTERS.map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value));
  return procurementRead(request, async (client, context) => listSupplierPayments(client, context, filters), "procurement.bills.view");
}

export async function POST(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context, input, session) => {
    const result = await paySupplierBills(client, context, input);
    // The advice goes to each supplier paid now (payments awaiting approval send theirs once approved).
    const advice = await sendAdviceForPayments(client, session, context, result.payments.filter((payment) => payment.status === "posted").map((payment) => String(payment.paymentId)));
    return { result: { ...result, payments: result.payments.map((payment) => ({ ...payment, advice: advice[String(payment.paymentId)] ?? null })) } };
  }, 201, "procurement.bills.view");
}
