import { z } from "zod";

import { approveOpeningBalances, rejectOpeningBalances, reverseOpeningBalances, submitOpeningBalances } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { accountingMutation } from "@/features/accounting/shared/route-helpers";

// submit · approve (a second person; posts them) · reject · reverse.
const PERMISSION: Record<string, string> = { submit: "accounting.journal.submit", approve: "accounting.journal.approve", reject: "accounting.journal.approve", reverse: "accounting.journal.reverse" };

export async function POST(request: Request, ctx: { params: Promise<{ openingId: string; action: string }> }) {
  const { openingId, action } = await ctx.params;
  return accountingMutation(request, z.object({ reason: z.string().max(500).optional() }), async (client, context, input) => {
    switch (action) {
      case "submit": return { openingBalances: await submitOpeningBalances(client, context, openingId) };
      case "approve": return { openingBalances: await approveOpeningBalances(client, context, openingId) };
      case "reject": return { openingBalances: await rejectOpeningBalances(client, context, openingId, input) };
      case "reverse": return { openingBalances: await reverseOpeningBalances(client, context, openingId, input) };
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  }, 200, PERMISSION[action] ?? "accounting.view");
}
