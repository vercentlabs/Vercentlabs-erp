import { removeVarianceTolerance } from "@vercentlabs/api";
import { z } from "zod";

import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

// Stop an override: the item or group falls back to the company's tolerance.
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingMutation(request, z.record(z.string(), z.unknown()), async (client, context) => removeVarianceTolerance(client, context, id));
}
