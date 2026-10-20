import { z } from "zod";

import { getExpenseRecord, updateExpense } from "@vercentlabs/api";

import { accountingMutation, accountingRead } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ expenseId: string }> };

// One expense: its evidence, posting, payment, similar expenses and trail.
export async function GET(request: Request, { params }: Params) {
  const { expenseId } = await params;
  return accountingRead(request, async (client, context) => ({ expense: await getExpenseRecord(client, context, expenseId) }));
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
const schema = z.object({ ...fields, version: z.number().int().optional() });

// Edits a draft, or one sent back (and submits it again with submit: true).
export async function PATCH(request: Request, { params }: Params) {
  const { expenseId } = await params;
  return accountingMutation(request, schema, async (client, context, input) => ({ expense: await updateExpense(client, context, expenseId, input) }));
}
