import { z } from "zod";

import { createFundTransfer, listFundTransfers } from "@vercentlabs/api";

import { accountingMutation, accountingRead } from "@/features/accounting/shared/route-helpers";

// Bank and cash transfers.
export async function GET(request: Request) {
  return accountingRead(request, async (client, context) => ({ transfers: await listFundTransfers(client, context) }));
}

const schema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  date: z.string().date().optional(),
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  amount: z.union([z.number(), z.string()]),
  reference: z.string().max(200).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
});

export async function POST(request: Request) {
  return accountingMutation(request, schema, async (client, context, input) => ({ transfer: await createFundTransfer(client, context, input) }), 201, "accounting.bank.manage");
}
