import {
  approveAssignmentRequest, cancelAssignmentRequest, completeAssignmentReturn, extendAssignment, issueAssignedAsset, rejectAssignmentRequest, requestAssignmentChanges, requestAssignmentReturn, submitAssignmentRequest,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation } from "@/features/assets/shared/route-helpers";

// POST submit · approve { asset?, note? } · request-changes { note } · reject { reason } · cancel { reason } · issue { identifier, condition, accessories? }
//      · return-request { note? } · return-confirm { identifier, condition, toType, storeLocationId? | departmentId?, … } · extend { expectedReturnDate, reason }
type Params = { params: Promise<{ id: string; action: string }> };
export async function POST(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "submit": return submitAssignmentRequest(client, context, id, input);
      case "approve": return approveAssignmentRequest(client, context, id, input);
      case "request-changes": return requestAssignmentChanges(client, context, id, input);
      case "reject": return rejectAssignmentRequest(client, context, id, input);
      case "cancel": return cancelAssignmentRequest(client, context, id, input);
      case "issue": return issueAssignedAsset(client, context, id, input);
      case "return-request": return requestAssignmentReturn(client, context, id, input);
      case "return-confirm": return completeAssignmentReturn(client, context, id, input);
      case "extend": return extendAssignment(client, context, id, input);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
