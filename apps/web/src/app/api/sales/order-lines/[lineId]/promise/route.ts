import { z } from "zod";

import { setSalesOrderLinePromise } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

const schema = z.object({ promisedDate: z.string().trim().min(10), note: z.string().trim().max(500) });

// F048: give a backordered line a promise date and say what it rests on.
export async function POST(request: Request, ctx: { params: Promise<{ lineId: string }> }) {
  const { lineId } = await ctx.params;
  return salesMutation(request, "sales.fulfillment.request", schema, async (client, context, input) => ({
    promise: await setSalesOrderLinePromise(client, context, { salesOrderLineId: lineId, ...input }),
  }));
}
