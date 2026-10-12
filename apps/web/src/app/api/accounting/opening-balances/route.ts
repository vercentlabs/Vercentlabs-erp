import { z } from "zod";

import { listOpeningBalances, saveOpeningBalances } from "@vercentlabs/api";

import { accountingMutation, accountingRead } from "@/features/accounting/shared/route-helpers";

// Opening balances.
export async function GET(request: Request) {
  return accountingRead(request, async (client, context) => ({ openingBalances: await listOpeningBalances(client, context) }));
}

const schema = z.object({
  id: z.string().uuid().optional(),
  asOfDate: z.string().date(),
  description: z.string().max(300).optional(),
  lines: z.array(z.object({ accountId: z.string().uuid(), debit: z.union([z.number(), z.string()]).optional(), credit: z.union([z.number(), z.string()]).optional(),
    description: z.string().max(300).optional() })).min(1).max(500),
});

export async function POST(request: Request) {
  return accountingMutation(request, schema, async (client, context, input) => ({ openingBalances: await saveOpeningBalances(client, context, input) }), 200, "accounting.journal.create");
}
