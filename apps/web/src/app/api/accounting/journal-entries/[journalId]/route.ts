import { getJournalRecord, updateManualJournal } from "@vercentlabs/api";

import { accountingMutation, accountingRead } from "@/features/accounting/shared/route-helpers";
import { manualJournalSchema } from "../schema";

type Params = { params: Promise<{ journalId: string }> };

// One journal: its lines, its source document, its posting history, its audit trail, and its reversal and correction links.
export async function GET(request: Request, { params }: Params) {
  const { journalId } = await params;
  return accountingRead(request, async (client, context) => ({ journal: await getJournalRecord(client, context, journalId) }));
}

// Editing a draft, or one sent back for changes.
export async function PATCH(request: Request, { params }: Params) {
  const { journalId } = await params;
  return accountingMutation(request, manualJournalSchema, async (client, context, input) => ({ journal: await updateManualJournal(client, context, journalId, input) }));
}
