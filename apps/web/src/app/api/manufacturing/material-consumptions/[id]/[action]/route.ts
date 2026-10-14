import {
  cancelMaterialConsumption, checkMaterialConsumptionPosting, decideConsumptionVarianceApproval, getMaterialConsumption, postMaterialConsumption, previewMaterialConsumption,
  recordMaterialConsumptionPrint, recoverMaterialConsumption, requestConsumptionVarianceApproval, reverseMaterialConsumption,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { consumptionActionSchema } from "@/features/manufacturing/consumption/api/mc-schemas";
import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// GET preview (against the BOM and custody; changes nothing) · posting-status · document (the note to print).
export async function GET(request: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  return manufacturingRead(request, async (client, context) => {
    switch (action) {
      case "preview": return { preview: await previewMaterialConsumption(client, context, id) };
      case "posting-status": return { posting: await checkMaterialConsumptionPosting(client, context, id) };
      case "document": return { consumption: await getMaterialConsumption(client, context, id) };
      default: throw new HttpError(404, "Unknown consumption view.", "NOT_FOUND");
    }
  });
}

// preview · request-approval · decide-approval · post · cancel · request-correction · print (counts a copy; changes nothing) · recover.
export async function POST(request: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  return manufacturingMutation(request, consumptionActionSchema, async (client, context, input) => {
    switch (action) {
      case "preview": return { preview: await previewMaterialConsumption(client, context, id) };
      case "request-approval": return { consumption: await requestConsumptionVarianceApproval(client, context, id, input) };
      case "decide-approval": return { consumption: await decideConsumptionVarianceApproval(client, context, id, input) };
      case "post": return await postMaterialConsumption(client, context, id, input);
      case "cancel": return { consumption: await cancelMaterialConsumption(client, context, id, input) };
      case "request-correction": return { consumption: await reverseMaterialConsumption(client, context, id, input) };
      case "print": return { consumption: await recordMaterialConsumptionPrint(client, context, id) };
      case "recover": return await recoverMaterialConsumption(client, context, id);
      default: throw new HttpError(404, "Unknown consumption action.", "NOT_FOUND");
    }
  });
}
