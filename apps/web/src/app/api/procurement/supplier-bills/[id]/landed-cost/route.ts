import { allocateLandedCost, getBillLandedCosts } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// A bill's charges shared over the goods they brought (Procurement plan Phase 3): what can be allocated and what was; allocating one.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const filters = { search: url.searchParams.get("search") ?? "", from: url.searchParams.get("from"), to: url.searchParams.get("to") };
  return procurementRead(request, async (client, context) => ({ landedCost: await getBillLandedCosts(client, context, id, filters) }), "procurement.bills.view");
}

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await allocateLandedCost(client, context, id, input) }), 201, "procurement.bills.view");
}
