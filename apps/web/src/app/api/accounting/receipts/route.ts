import { z } from "zod";

import { listCustomerReceipts, recordCustomerReceipt } from "@vercentlabs/api";

import { accountingMutation, accountingRead } from "@/features/accounting/shared/route-helpers";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters: Record<string, string> = {};
  for (const key of ["view", "partyId", "search", "from", "to"]) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  return accountingRead(request, async (client, context) => ({ receipts: await listCustomerReceipts(client, context, filters) }));
}

const amount = z.string().trim().regex(/^\d{1,15}(\.\d{1,6})?$/, "Enter an amount such as 1250.50");
const schema = z.object({
  partyId: z.string().uuid(), receiptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), amount, currencyCode: z.string().length(3).optional(), exchangeRate: z.string().optional(),
  bankAccountId: z.string().uuid().nullable().optional(), paymentMethod: z.enum(["cash", "bank_transfer", "card", "upi", "cheque", "gateway", "other"]),
  reference: z.string().max(200).nullable().optional(), notes: z.string().max(2000).nullable().optional(), applyToOldest: z.boolean().optional(),
  allocations: z.array(z.object({ invoiceId: z.string().uuid(), amount, discountTaken: amount.optional(), writeoffAmount: amount.optional() })).max(200).optional(),
});

// A customer's payment, recorded and posted in one step, then applied to chosen invoices (or the oldest ones); the rest stays as an advance.
export async function POST(request: Request) {
  return accountingMutation(request, schema, async (client, context, input) => ({ receipt: await recordCustomerReceipt(client, context, input) }), 201);
}
