import { createRejectionFromQualityInspection } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Quality failed goods held at receipt: the rejection case for its decision (opened once; a retry returns it).
type Params = { params: Promise<{ inspectionId: string }> };

export async function POST(request: Request, ctx: Params) {
  const { inspectionId } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await createRejectionFromQualityInspection(client, context, inspectionId, input) }), 201,
    "procurement.rejections.quality");
}
