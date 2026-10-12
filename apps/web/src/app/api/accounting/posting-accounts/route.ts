import { z } from "zod";

import { listPostingAccounts, setPostingAccount } from "@vercentlabs/api";

import { accountingMutation, accountingRead } from "@/features/accounting/shared/route-helpers";

// The posting accounts, in plain words, with their health.
export async function GET(request: Request) {
  return accountingRead(request, async (client, context) => ({ postingAccounts: await listPostingAccounts(client, context) }));
}

// Changes the account a posting uses from today on; earlier entries keep theirs.
const schema = z.object({ key: z.string().trim().min(1).max(100), accountId: z.string().uuid() });

export async function POST(request: Request) {
  return accountingMutation(request, schema, async (client, context, input) => ({ result: await setPostingAccount(client, context, input) }), 200, "accounting.settings.manage");
}
