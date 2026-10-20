import { z } from "zod";

import { getBankCashAccount, listBankStatementsOverview, updateBankCashAccount } from "@vercentlabs/api";

import { accountingMutation, accountingRead } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ accountId: string }> };

// One bank or cash account, with its statements.
export async function GET(request: Request, { params }: Params) {
  const { accountId } = await params;
  return accountingRead(request, async (client, context) => ({
    account: await getBankCashAccount(client, context, accountId),
    statements: await listBankStatementsOverview(client, context, { bankAccountId: accountId }),
  }));
}

const schema = z.object({
  name: z.string().trim().min(1).max(200).optional(), bankName: z.string().trim().max(200).optional(),
  accountNumber: z.string().trim().max(40).regex(/^[0-9 ]*$/, "Digits only").nullable().optional(), ifsc: z.string().trim().max(20).nullable().optional(),
  custodianUserId: z.string().uuid().nullable().optional(), notes: z.string().max(2000).nullable().optional(), status: z.enum(["active", "inactive"]).optional(),
});

// Edits the account, hands the cash to another person, or closes (an account with money in it isn't closed) / reopens it.
export async function PATCH(request: Request, { params }: Params) {
  const { accountId } = await params;
  return accountingMutation(request, schema, async (client, context, input) => ({ account: await updateBankCashAccount(client, context, accountId, input) }));
}
