import { getActiveProductionHold, placeManufacturingOrderOnHold } from "@vercentlabs/api";

import { holdSchema } from "@/features/manufacturing/holds/api/hold-schemas";
import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// The order's active production hold (null when it is not held).
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingRead(request, async (client, context) => ({ hold: await getActiveProductionHold(client, context, id) }));
}

// Put the order on hold — or, when it is already held, add this reason to the hold in force.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingMutation(request, holdSchema, async (client, context, input) => placeManufacturingOrderOnHold(client, context, id, input), 201);
}
