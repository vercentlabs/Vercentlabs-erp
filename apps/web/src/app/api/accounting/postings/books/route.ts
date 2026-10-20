import { getModuleReconciliation } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

// Each sub-ledger (customers, suppliers, stock, goods received, assets, payroll) against the accounts that summarise it.
export async function GET(request: Request) {
  return accountingRead(request, async (client, context) => ({ books: await getModuleReconciliation(client, context) }));
}
