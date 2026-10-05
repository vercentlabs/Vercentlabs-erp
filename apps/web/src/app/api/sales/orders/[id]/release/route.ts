import { z } from "zod";

import { releaseSalesOrderReservation } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Gives back stock reserved for the order, one line, or part of a line, with a reason.
const schema = z.object({
  lineId: z.string().uuid().optional(),
  quantity: z.union([z.number(), z.string()]).optional(),
  reasonCode: z.string().max(40).optional(),
  reason: z.string().max(500).optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.reservation.release", schema, async (client, context, input) => ({ result: await releaseSalesOrderReservation(client, context, id, input) }));
}
