import { getJournalEntryDetail } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

// One journal: its lines, its source document, its posting history and its reversal.
export async function GET(request: Request, ctx: { params: Promise<{ journalId: string }> }) {
  const { journalId } = await ctx.params;
  return accountingRead(request, async (client, context) => ({ journal: await getJournalEntryDetail(client, context, journalId) }));
}
