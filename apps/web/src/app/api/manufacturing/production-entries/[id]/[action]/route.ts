import { z } from "zod";

import { cancelProductionEntry, correctProductionEntry, decideManufacturingQuality, getProductionEntry, postProductionEntry, recordProductionEntryPrint } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

const quantity = z.union([z.string(), z.number()]).transform((value) => String(value));
const schema = z.object({
  expectedVersion: z.number().int().optional(), expectedMoVersion: z.number().int().optional(), materialOverrideReason: z.string().max(1000).optional(), reason: z.string().max(1000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(), kind: z.enum(["PENDING", "ACCEPTED"]).optional(), quantity: quantity.optional(), evidence: z.string().max(1000).optional(),
  acceptedQuantity: quantity.optional(), rejectedQuantity: quantity.optional(), rejectionReason: z.string().max(500).optional(), reasonCode: z.string().max(60).optional(),
  disposition: z.enum(["QUARANTINE", "SCRAP", "REWORK"]).optional(), inspectionReference: z.string().max(120).optional(), expectedEntryVersion: z.number().int().optional(),
});

// post · cancel · quality-decisions · request-correction · print (counts a copy; changes nothing). Each checks its own permission in the domain.
export async function POST(request: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  return manufacturingMutation(request, schema, async (client, context, input) => {
    switch (action) {
      case "post": await postProductionEntry(client, context, id, input); break;
      case "cancel": await cancelProductionEntry(client, context, id, input); break;
      case "quality-decisions": {
        const entry = await getProductionEntry(client, context, id);
        await decideManufacturingQuality(client, context, entry.order.id, { ...input, entryId: id });
        break;
      }
      case "request-correction": await correctProductionEntry(client, context, id, input); break;
      case "print": await recordProductionEntryPrint(client, context, id); break;
      default: throw new HttpError(404, "Unknown production entry action.", "NOT_FOUND");
    }
    return { entry: await getProductionEntry(client, context, id) };
  });
}
