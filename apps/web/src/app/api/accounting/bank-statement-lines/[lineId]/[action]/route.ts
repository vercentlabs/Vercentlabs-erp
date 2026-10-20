import { z } from "zod";

import {
  acceptSuggestion, clearLineException, ignoreStatementLine, markLineException, matchStatementLine, postEntryForLine, unmatchStatementLine,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { accountingMutation } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ lineId: string; action: string }> };
const schema = z.object({
  journalLineIds: z.array(z.string().uuid()).max(50).optional(), note: z.string().max(1000).optional(), reason: z.string().trim().max(500).optional(),
  accountId: z.string().uuid().optional(), description: z.string().max(300).optional(),
});

// accept (the suggestion) · match (one or more entries adding up exactly) · unmatch · exception · clear-exception · ignore · post-entry.
export async function POST(request: Request, { params }: Params) {
  const { lineId, action } = await params;
  return accountingMutation(request, schema, async (client, context, input) => {
    switch (action) {
      case "accept": return acceptSuggestion(client, context, lineId);
      case "match": return matchStatementLine(client, context, lineId, { journalLineIds: input.journalLineIds ?? [], note: input.note });
      case "unmatch": return unmatchStatementLine(client, context, lineId);
      case "exception": return markLineException(client, context, lineId, { reason: input.reason ?? "" });
      case "clear-exception": return clearLineException(client, context, lineId);
      case "ignore": return ignoreStatementLine(client, context, lineId, { reason: input.reason ?? "" });
      case "post-entry": return postEntryForLine(client, context, lineId, { accountId: input.accountId ?? "", description: input.description });
      default: throw new HttpError(404, "Unknown statement line action.");
    }
  });
}
