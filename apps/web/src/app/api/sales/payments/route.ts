import { z } from "zod";

import { listSalesPayments, recordCustomerPayment } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

// Payments received: ?search=&from=&to=&limit=&offset= (Line-by-line audit).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const read = (name: string) => url.searchParams.get(name) ?? undefined;
  return salesRead(request, "sales.invoice.payments.view", async (client, context) =>
    listSalesPayments(client, context, { search: read("search"), from: read("from"), to: read("to"), limit: Number(read("limit") ?? 25), offset: Number(read("offset") ?? 0) }));
}

// Payments Received › New (Sales plan, Flow 4): a customer's payment applied to its bills (oldest first unless allocations are given; an
// empty list keeps it all as an advance). The operation checks "record payments" and the customer's scope.
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.object({
  partyId: z.string().uuid(),
  amount: z.number().positive(),
  receiptDate: day.optional(),
  paymentMethod: z.enum(["upi", "bank_transfer", "cheque", "cash", "card", "other"]).optional(),
  reference: z.string().max(200).optional(),
  chequeNumber: z.string().max(20).optional(),
  chequeDate: day.optional(),
  draweeBank: z.string().max(100).optional(),
  bankAccountId: z.string().uuid().nullish(),
  notes: z.string().max(1000).optional(),
  allocations: z.array(z.object({ invoiceId: z.string().uuid(), amount: z.number().min(0), tdsAmount: z.number().min(0).optional(), tdsSection: z.string().max(20).optional() })).max(500).optional(),
});

export async function POST(request: Request) {
  return salesMutation(request, "sales.view", schema, async (client, context, input) => ({ result: await recordCustomerPayment(client, context, input) }), 201);
}
