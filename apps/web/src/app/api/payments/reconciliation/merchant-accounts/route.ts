import { z } from "zod";

import { listMerchantAccounts, listReconciliationBankAccounts, saveMerchantAccount } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

// GET: merchant accounts (provider + merchant reference, the bank account payouts reach, settlement days).
export async function GET(request: Request) {
  return posRead(request, async (client, context) => ({ merchantAccounts: await listMerchantAccounts(client, context), bankAccounts: await listReconciliationBankAccounts(client, context) }), "pos.view");
}

// POST: save a merchant account.
const schema = z.object({
  id: z.string().uuid().optional(),
  providerKey: z.string().trim().max(60).optional(),
  merchantAccountReference: z.string().trim().max(120).optional(),
  displayName: z.string().trim().max(120).optional(),
  paymentMethods: z.array(z.enum(["card", "upi", "wallet", "bank_transfer"])).max(4).optional(),
  bankAccountId: z.string().uuid().nullable().optional(),
  settlementExpectedDays: z.number().int().min(0).max(60).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export async function POST(request: Request) {
  return posMutation(request, schema, async (client, context, input) => ({ merchantAccount: await saveMerchantAccount(client, context, input) }), 200, "pos.view");
}
