import { z } from "zod";

import { createChartAccount, listChartOfAccounts } from "@vercentlabs/api";

import { accountingMutation, accountingRead } from "@/features/accounting/shared/route-helpers";

// The Chart of Accounts as a tree, with each account's posted balance and the posting rules that use it.
export async function GET(request: Request) {
  return accountingRead(request, async (client, context) => ({ chart: await listChartOfAccounts(client, context) }));
}

// The domain checks accounting.chart.manage (or the older settings permission) and every chart rule.
const schema = z.object({
  code: z.string().trim().min(1).max(20), name: z.string().trim().min(1).max(200), accountClass: z.string().min(1), accountType: z.string().optional(),
  isGroup: z.boolean().optional(), parentId: z.string().uuid().nullable().optional(), allowManualPosting: z.boolean().optional(),
  reconciliationRequired: z.boolean().optional(), cashFlowCategory: z.string().nullable().optional(), currencyCode: z.string().max(3).nullable().optional(),
});

export async function POST(request: Request) {
  return accountingMutation(request, schema, async (client, context, input) => ({ account: await createChartAccount(client, context, input) }), 201);
}
