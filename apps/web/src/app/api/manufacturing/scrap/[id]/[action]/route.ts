import {
  cancelScrap, checkScrapPosting, decideScrap, decideScrapCorrection, getManufacturingScrap, postScrap, previewScrap, recordScrapPrint, recoverScrap, requestScrapCorrection, submitScrap,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { scrapActionSchema } from "@/features/manufacturing/scrap/api/scrap-schemas";
import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// GET preview (what posting would do now; moves nothing) · posting-status (the note against Inventory and Finance) · document (the note to print).
export async function GET(request: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  return manufacturingRead(request, async (client, context) => {
    switch (action) {
      case "preview": return { preview: await previewScrap(client, context, id) };
      case "posting-status": return { posting: await checkScrapPosting(client, context, id) };
      case "document": return { scrap: await getManufacturingScrap(client, context, id) };
      default: throw new HttpError(404, "Unknown scrap view.", "NOT_FOUND");
    }
  });
}

// submit · approve (decision APPROVE | REJECT) · post · cancel · request-correction · decide-correction · print (counts a copy) · recover.
export async function POST(request: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  return manufacturingMutation(request, scrapActionSchema, async (client, context, input) => {
    switch (action) {
      case "preview": return { preview: await previewScrap(client, context, id) };
      case "submit": return { scrap: await submitScrap(client, context, id, input) };
      case "approve": return { scrap: await decideScrap(client, context, id, input) };
      case "post": return await postScrap(client, context, id, input);
      case "cancel": return { scrap: await cancelScrap(client, context, id, input) };
      case "request-correction": return { scrap: await requestScrapCorrection(client, context, id, input) };
      case "decide-correction": return { scrap: await decideScrapCorrection(client, context, id, input) };
      case "print": return { scrap: await recordScrapPrint(client, context, id) };
      case "recover": return await recoverScrap(client, context, id);
      default: throw new HttpError(404, "Unknown scrap action.", "NOT_FOUND");
    }
  });
}
