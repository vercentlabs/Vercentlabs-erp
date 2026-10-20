import { z } from "zod";

import {
  approveJournalEntry, correctManualJournal, discardManualJournal, getJournalRecord, postJournalEntry, rejectJournalApproval, reverseManualJournal, submitJournalEntry,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { accountingMutation } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ journalId: string; action: string }> };

const schema = z.object({
  reason: z.string().trim().max(500).optional(), accountingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), contentHash: z.string().max(200).optional(),
});

// The steps of a manual journal: submit → approve (someone else) or send back → post; reverse or reverse-and-correct a posted one;
// discard a draft. Each step's rules (permission, separation of duties, period, balance) are the domain's.
export async function POST(request: Request, { params }: Params) {
  const { journalId, action } = await params;
  return accountingMutation(request, schema, async (client, context, input) => {
    switch (action) {
      case "submit": await submitJournalEntry(client, context, journalId); break;
      case "approve": await approveJournalEntry(client, context, journalId, input.contentHash ?? ""); break;
      case "reject": await rejectJournalApproval(client, context, journalId); break;
      case "post": await postJournalEntry(client, context, journalId); break;
      case "reverse": return { journal: await reverseManualJournal(client, context, journalId, { reason: input.reason ?? "", accountingDate: input.accountingDate }) };
      case "correct": return { journal: await correctManualJournal(client, context, journalId, { reason: input.reason ?? "", accountingDate: input.accountingDate }) };
      case "discard": return { journal: await discardManualJournal(client, context, journalId, { reason: input.reason ?? "" }) };
      default: throw new HttpError(404, "Unknown journal action.");
    }
    return { journal: await getJournalRecord(client, context, journalId) };
  });
}
