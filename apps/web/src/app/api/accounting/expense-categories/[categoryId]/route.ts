import { z } from "zod";

import { updateAccountingExpenseCategory } from "@vercentlabs/api";

import { accountingMutation } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ categoryId: string }> };
const amount = z.union([z.number(), z.string().trim().regex(/^\d{1,15}(\.\d{1,2})?$/)]);
const fields = {
  name: z.string().trim().min(1).max(120), code: z.string().trim().max(30).optional(), description: z.string().max(300).nullable().optional(), accountId: z.string().uuid(),
  defaultGstRate: z.union([z.number(), z.string()]).nullable().optional(), receiptRequired: z.boolean().optional(), receiptThreshold: amount.optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
};
const schema = z.object({ ...fields, status: z.enum(["active", "inactive"]).optional() }).partial();

// Edits a category, or switches it off / on (a category with expenses is never deleted).
export async function PATCH(request: Request, { params }: Params) {
  const { categoryId } = await params;
  return accountingMutation(request, schema, async (client, context, input) => ({ category: await updateAccountingExpenseCategory(client, context, categoryId, input) }));
}
