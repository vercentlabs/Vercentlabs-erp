import { z } from "zod";

import { allocateStockFairShare } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Shares a short product's free stock in a warehouse between the confirmed orders that need it (Sales plan, Phase 4). preview: work it
// out without reserving.
const schema = z.object({ itemId: z.string().uuid(), warehouseId: z.string().uuid(), preview: z.boolean().optional(), idempotencyKey: z.string().max(200).optional() });

export async function POST(request: Request) {
  return salesMutation(request, "sales.order.reserve", schema, async (client, context, input) => ({ result: await allocateStockFairShare(client, context, input) }));
}
