import { z } from "zod";

import { createAccountingBill, listPayableBills } from "@vercentlabs/api";

import { accountingMutation, accountingRead } from "@/features/accounting/shared/route-helpers";

// Supplier bills and credits as Finance sees them: what is still owed, when it falls due, and what is already in a payment.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters: Record<string, string> = {};
  for (const key of ["view", "partyId", "search"]) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  return accountingRead(request, async (client, context) => ({ bills: await listPayableBills(client, context, filters) }));
}

const amount = z.string().trim().regex(/^\d{1,15}(\.\d{1,6})?$/, "Enter an amount such as 1250.50");
const line = z.object({
  description: z.string().trim().min(1, "Describe the line.").max(1000), quantity: amount, unitPrice: amount, gstRate: z.number().min(0).max(40),
  itemId: z.string().uuid().nullable().optional(), hsnSacCode: z.string().max(30).nullable().optional(),
});
const schema = z.object({
  partyId: z.string().uuid(), billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  supplierInvoiceReference: z.string().max(100).nullable().optional(), notes: z.string().max(2000).nullable().optional(), lines: z.array(line).min(1).max(200), post: z.boolean().optional(),
});

// Accounting's New bill: a supplier's bill recorded here, saved as a draft or posted at once.
export async function POST(request: Request) {
  return accountingMutation(request, schema, async (client, context, input) => ({ bill: await createAccountingBill(client, context, input) }), 201);
}
