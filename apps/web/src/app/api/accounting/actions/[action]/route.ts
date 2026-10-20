import { z } from "zod";

import { updateAccountingSettings } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { accountingMutation } from "@/features/accounting/shared/route-helpers";

const body = z.record(z.string(), z.unknown());

// The Posting accounts screen's settings save. (Every other Accounting operation has its own route.)
export async function POST(request: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  return accountingMutation(request, body, async (client, context, input) => {
    if (action === "settings-save") return { record: await updateAccountingSettings(client, context, { ...input }) };
    throw new HttpError(404, "Unknown Accounting action.");
  }, 200, "accounting.view");
}
