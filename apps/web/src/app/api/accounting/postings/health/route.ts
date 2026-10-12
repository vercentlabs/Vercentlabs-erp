import { getPostingCoverage, getPostingHealth } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

// The books balance, nothing is stuck, and what each module posted.
export async function GET(request: Request) {
  return accountingRead(request, async (client, context) => ({ health: await getPostingHealth(client, context), coverage: await getPostingCoverage(client, context) }));
}
