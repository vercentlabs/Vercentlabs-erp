import { searchJournalEntries } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

// The journal list, filtered by date, account, document type, status and automatic / manual.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters: Record<string, string> = {};
  for (const key of ["from","to","status","documentType","origin","accountId","search","limit"]) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  return accountingRead(request, async (client, context) => ({ journals: await searchJournalEntries(client, context, filters) }));
}
