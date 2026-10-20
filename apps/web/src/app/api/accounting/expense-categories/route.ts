import { z } from "zod";

import { createAccountingExpenseCategory, getAccountingExpenseCategoryOptions, listAccountingExpenseCategories } from "@vercentlabs/api";

import { accountingMutation, accountingRead } from "@/features/accounting/shared/route-helpers";

// The company's expense categories (with the expense accounts a category may post to).
export async function GET(request: Request) {
  const includeInactive = new URL(request.url).searchParams.get("includeInactive") === "true";
  return accountingRead(request, async (client, context) => ({
    categories: await listAccountingExpenseCategories(client, context, { includeInactive }), options: await getAccountingExpenseCategoryOptions(client, context),
  }));
}

const amount = z.union([z.number(), z.string().trim().regex(/^\d{1,15}(\.\d{1,2})?$/)]);
const fields = {
  name: z.string().trim().min(1).max(120), code: z.string().trim().max(30).optional(), description: z.string().max(300).nullable().optional(), accountId: z.string().uuid(),
  defaultGstRate: z.union([z.number(), z.string()]).nullable().optional(), receiptRequired: z.boolean().optional(), receiptThreshold: amount.optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
};

export async function POST(request: Request) {
  return accountingMutation(request, z.object(fields), async (client, context, input) => ({ category: await createAccountingExpenseCategory(client, context, input) }), 201);
}
