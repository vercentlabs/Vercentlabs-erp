import {
  approveAssetTransfer, cancelAssetTransfer, createReturnTransfer, dispatchAssetTransfer, rejectAssetTransfer, requestTransferChanges, submitAssetTransfer,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation } from "@/features/assets/shared/route-helpers";

// POST submit · approve { note? } · request-changes { note } · reject { reason } · cancel { reason } · dispatch { condition, lineIds?, transitHolder?, … } · return { plannedDate? }
type Params = { params: Promise<{ id: string; action: string }> };
export async function POST(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "submit": return submitAssetTransfer(client, context, id, input);
      case "approve": return approveAssetTransfer(client, context, id, input);
      case "request-changes": return requestTransferChanges(client, context, id, input);
      case "reject": return rejectAssetTransfer(client, context, id, input);
      case "cancel": return cancelAssetTransfer(client, context, id, input);
      case "dispatch": return dispatchAssetTransfer(client, context, id, input);
      case "return": return createReturnTransfer(client, context, id, input);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
