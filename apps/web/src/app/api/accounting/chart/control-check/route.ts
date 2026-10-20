import { getControlAccountReconciliation } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

// Opening cutover check: each control account against the sub-ledger it summarises.
export async function GET(request: Request) {
  return accountingRead(request, async (client, context) => ({ checks: await getControlAccountReconciliation(client, context) }));
}
