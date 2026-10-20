import { z } from "zod";

import { createExpense, getExpenseCounts, listExpenses } from "@vercentlabs/api";

import { accountingMutation, accountingRead } from "@/features/accounting/shared/route-helpers";

// Expenses: the lists (view = to_approve | to_pay | drafts | mine | posted | closed) and their counts.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters: Record<string, string> = {};
  for (const key of ["view", "status", "search", "categoryId", "from", "to"]) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  return accountingRead(request, async (client, context) => ({ expenses: await listExpenses(client, context, filters), counts: await getExpenseCounts(client, context) }));
}

const amount = z.union([z.number(), z.string().trim().regex(/^\d{1,15}(\.\d{1,2})?$/, "Enter an amount such as 1250.50")]);
const fields = {
  categoryId: z.string().uuid(), date: z.string().date(), description: z.string().trim().min(1).max(500), amount,
  partyId: z.string().uuid().nullable().optional(), payeeName: z.string().max(200).nullable().optional(),
  supplierGstin: z.string().max(15).nullable().optional(), supplierInvoiceReference: z.string().max(100).nullable().optional(),
  gstTreatment: z.enum(["NO_GST", "GST_CLAIM_ITC", "GST_NO_ITC"]).default("NO_GST"), gstSupply: z.enum(["INTRA_STATE", "INTER_STATE"]).nullable().optional(),
  gstRate: z.union([z.number(), z.string()]).nullable().optional(), settlement: z.enum(["PAID", "PAYABLE"]),
  paidFromAccountId: z.string().uuid().nullable().optional(), paymentMethod: z.enum(["cash", "upi", "card", "bank_transfer", "cheque", "other"]).nullable().optional(),
  claimantUserId: z.string().uuid().nullable().optional(), departmentId: z.string().uuid().nullable().optional(), costCenterId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(), noReceiptReason: z.string().max(500).nullable().optional(), submit: z.boolean().optional(),
};
const schema = z.object({ idempotencyKey: z.string().trim().min(1).max(200).optional(), ...fields });

// A new expense (a draft, or submitted at once with submit: true).
export async function POST(request: Request) {
  return accountingMutation(request, schema, async (client, context, input) => ({ expense: await createExpense(client, context, input) }), 201);
}
