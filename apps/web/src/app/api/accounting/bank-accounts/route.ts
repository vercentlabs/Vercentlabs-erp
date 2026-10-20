import { z } from "zod";

import { createBankCashAccount, listBankCashAccounts } from "@vercentlabs/api";

import { accountingMutation, accountingRead } from "@/features/accounting/shared/route-helpers";

// The company's bank and cash accounts, each with its balance, who holds the cash, and what is left to reconcile.
export async function GET(request: Request) {
  const includeInactive = new URL(request.url).searchParams.get("includeInactive") === "true";
  return accountingRead(request, async (client, context) => ({ accounts: await listBankCashAccounts(client, context, { includeInactive }) }));
}

const schema = z.object({
  kind: z.enum(["bank", "cash"]), name: z.string().trim().min(1).max(200), bankName: z.string().trim().max(200).nullable().optional(),
  accountNumber: z.string().trim().max(40).regex(/^[0-9 ]*$/, "Digits only").nullable().optional(), ifsc: z.string().trim().max(20).nullable().optional(),
  type: z.enum(["current", "savings", "credit_card", "loan", "virtual", "other"]).optional(), currencyCode: z.string().length(3).optional(),
  ledgerAccountId: z.string().uuid().nullable().optional(), custodianUserId: z.string().uuid().nullable().optional(), notes: z.string().max(2000).nullable().optional(),
});

// A new bank or cash account; without a ledger account chosen, one is created under Cash and bank.
export async function POST(request: Request) {
  return accountingMutation(request, schema, async (client, context, input) => ({ account: await createBankCashAccount(client, context, input) }), 201);
}
