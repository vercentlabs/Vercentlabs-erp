import { getBankAccountFormOptions } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

// The bank / cash account form's choices: free ledger accounts and the people who can hold cash.
export async function GET(request: Request) {
  return accountingRead(request, async (client, context) => ({ options: await getBankAccountFormOptions(client, context) }));
}
