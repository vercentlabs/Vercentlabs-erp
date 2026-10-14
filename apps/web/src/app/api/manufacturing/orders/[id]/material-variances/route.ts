import { getMoMaterialVariances } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// The order's material usage variance per line (?basis=REPORTED_OUTPUT|GOOD_OUTPUT|ORIGINAL_PLAN|AUTHORIZED_PLAN), evaluated now from posted records.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const basis = new URL(request.url).searchParams.get("basis") || undefined;
  return manufacturingRead(request, async (client, context) => ({ variances: await getMoMaterialVariances(client, context, id, basis ? { basis } : {}) }));
}
