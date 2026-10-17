import { approveOpeningFinancials, cancelOpeningBatch, closeOpeningBatch, prepareFinanceOpeningBalance, registerOpeningBatch, updateOpeningRow, validateOpeningBatch } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation } from "@/features/assets/shared/route-helpers";

// POST validate · register { expectedVersion? } · cancel { reason? } · row { row, corrections?, resolution?, linkAssetId? } · prepare-finance · approve { mode, varianceReason?, expectedVersion? } · close
type Params = { params: Promise<{ id: string; action: string }> };
export async function POST(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "validate": return validateOpeningBatch(client, context, id);
      case "register": return registerOpeningBatch(client, context, id, input);
      case "cancel": return cancelOpeningBatch(client, context, id, input);
      case "row": return updateOpeningRow(client, context, id, Number(input.row), input);
      case "prepare-finance": return prepareFinanceOpeningBalance(client, context, id);
      case "approve": return approveOpeningFinancials(client, context, id, input);
      case "close": return closeOpeningBatch(client, context, id);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
