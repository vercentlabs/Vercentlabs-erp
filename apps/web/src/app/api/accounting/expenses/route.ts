import { z } from "zod";

import { createExpense, listExpenses } from "@vercentlabs/api";

import { accountingMutation, accountingRead } from "@/features/accounting/shared/route-helpers";

// Expenses.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters: Record<string, string> = {};
  for (const key of ["status","search"]) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  return accountingRead(request, async (client, context) => ({ expenses: await listExpenses(client, context, filters) }));
}

const schema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  date: z.string().date().optional(),
  description: z.string().trim().min(1).max(500),
  expenseAccountId: z.string().uuid(),
  partyId: z.string().uuid().nullable().optional(),
  payeeName: z.string().max(200).nullable().optional(),
  supplierGstin: z.string().max(15).nullable().optional(),
  supplierInvoiceReference: z.string().max(100).nullable().optional(),
  amount: z.union([z.number(), z.string()]),
  gstTreatment: z.enum(["NO_GST", "GST_CLAIM_ITC", "GST_NO_ITC"]).default("NO_GST"),
  gstSupply: z.enum(["INTRA_STATE", "INTER_STATE"]).optional(),
  gstRate: z.union([z.number(), z.string()]).optional(),
  settlement: z.enum(["PAID", "PAYABLE"]),
  paidFromAccountId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  costCenterId: z.string().uuid().nullable().optional(),
  submit: z.boolean().optional(),
});

export async function POST(request: Request) {
  return accountingMutation(request, schema, async (client, context, input) => ({ expense: await createExpense(client, context, input) }), 201, "accounting.payables.manage");
}
