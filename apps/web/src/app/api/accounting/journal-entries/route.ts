import { createManualJournal, searchJournalEntries } from "@vercentlabs/api";

import { accountingMutation, accountingRead } from "@/features/accounting/shared/route-helpers";
import { manualJournalSchema } from "./schema";

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

// A new manual journal, saved as a draft (the domain checks accounting.journal.create and every line).
export async function POST(request: Request) {
  return accountingMutation(request, manualJournalSchema, async (client, context, input) => ({
    journal: await createManualJournal(client, context, input),
  }), 201);
}
