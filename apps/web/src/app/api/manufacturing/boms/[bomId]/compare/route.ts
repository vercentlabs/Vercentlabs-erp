import { compareBomRevisions } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// Two revisions side by side (?from=&to=); with ?plannedQuantity= (and uomId, warehouseId, policy) also what each needs and costs, priced
// on the same basis.
export async function GET(request: Request, ctx: { params: Promise<{ bomId: string }> }) {
  const { bomId } = await ctx.params;
  const url = new URL(request.url);
  const param = (name: string) => url.searchParams.get(name) || undefined;
  const from = param("from") ?? "";
  const to = param("to") ?? "";
  return manufacturingRead(request, async (client, context) => {
    if (!from || !to) throw new HttpError(400, "Choose two revisions to compare.", "VALIDATION_FAILED");
    return { comparison: await compareBomRevisions(client, context, bomId, from, to, { plannedQuantity: param("plannedQuantity"), uomId: param("uomId"), warehouseId: param("warehouseId"),
      policy: param("policy") }) };
  });
}
