import { getTransferExceptions, getTransferHistory, getTransferReconciliation, getTransferReport, resolveTransferException, sendTransferReminders, validateAssetTransfer } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// GET exceptions · reconciliation · history (?assetId=) · report (?kind=) · POST validate { …as create } · resolve-exception { exceptionId, resolution, note, identifier?, condition? } · reminders
type Params = { params: Promise<{ action: string }> };
export async function GET(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  const url = new URL(request.url);
  const get = (name: string) => url.searchParams.get(name) ?? undefined;
  return assetsRead(request, async (client, context) => {
    switch (action) {
      case "exceptions": return { rows: await getTransferExceptions(client, context) };
      case "reconciliation": return getTransferReconciliation(client, context);
      case "history": return { rows: await getTransferHistory(client, context, { assetId: get("assetId") }) };
      case "report": return { rows: await getTransferReport(client, context, get("kind") ?? "all-transfers") };
      default: throw new HttpError(404, "Unknown view.", "NOT_FOUND");
    }
  });
}
export async function POST(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "validate": return validateAssetTransfer(client, context, input);
      case "resolve-exception": return resolveTransferException(client, context, String(input.exceptionId ?? ""), input);
      case "reminders": return sendTransferReminders(client, context);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
