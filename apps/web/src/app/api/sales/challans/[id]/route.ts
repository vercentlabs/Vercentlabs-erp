import { z } from "zod";

import { getSalesChallan, setSalesChallanStatus } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.order.view", async (client, context) => ({ challan: await getSalesChallan(client, context, id) }));
}

// { action: "issue" | "cancel", reason? }
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.delivery.dispatch", z.object({ action: z.enum(["issue", "cancel"]), reason: z.string().max(500).optional() }),
    async (client, context, input) => ({ challan: await setSalesChallanStatus(client, context, id, input) }));
}
