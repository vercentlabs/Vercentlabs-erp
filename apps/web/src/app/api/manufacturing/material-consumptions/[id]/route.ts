import { getMaterialConsumption, updateMaterialConsumptionDraft } from "@vercentlabs/api";

import { consumptionEditSchema } from "@/features/manufacturing/consumption/api/mc-schemas";
import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// One consumption note: lines against the BOM, the issued stock used, approval, corrections and timeline.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingRead(request, async (client, context) => ({ consumption: await getMaterialConsumption(client, context, id) }));
}

// Edit an unposted note under its version (an edit withdraws an approval).
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingMutation(request, consumptionEditSchema, async (client, context, input) => ({ consumption: await updateMaterialConsumptionDraft(client, context, id, input) }));
}
