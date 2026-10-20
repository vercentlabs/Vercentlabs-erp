import { getGeneralLedgerSummary } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

// Every posting account between two dates: brought forward, debits, credits and closing, by class, department or cost centre.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters: Record<string, string> = {};
  for (const key of ["from", "to", "accountClass", "departmentId", "costCenterId", "includeZero"]) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  return accountingRead(request, async (client, context) => ({ generalLedger: await getGeneralLedgerSummary(client, context, filters) }));
}
