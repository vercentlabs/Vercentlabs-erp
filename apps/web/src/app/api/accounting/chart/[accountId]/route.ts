import { z } from "zod";

import { deleteChartAccount, getChartAccount, updateChartAccount } from "@vercentlabs/api";

import { accountingMutation, accountingRead } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ accountId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { accountId } = await params;
  return accountingRead(request, async (client, context) => ({ account: await getChartAccount(client, context, accountId) }));
}

const schema = z.object({
  code: z.string().trim().min(1).max(20).optional(), name: z.string().trim().min(1).max(200).optional(), accountType: z.string().optional(),
  parentId: z.string().uuid().nullable().optional(), allowManualPosting: z.boolean().optional(), reconciliationRequired: z.boolean().optional(),
  cashFlowCategory: z.string().nullable().optional(), expectedUpdatedAt: z.string().optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  const { accountId } = await params;
  return accountingMutation(request, schema, async (client, context, input) => ({ account: await updateChartAccount(client, context, accountId, input) }));
}

// Only for a mistake: an account with postings, accounts under it or a posting rule can only be deactivated.
export async function DELETE(request: Request, { params }: Params) {
  const { accountId } = await params;
  return accountingMutation(request, z.object({}).passthrough(), async (client, context) => ({ result: await deleteChartAccount(client, context, accountId) }));
}
