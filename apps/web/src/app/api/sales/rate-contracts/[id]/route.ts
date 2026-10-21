import { z } from "zod";

import { getRateContract, saveRateContract, setRateContractStatus } from "@vercentlabs/api";

import { rateContractSchema } from "@/features/sales/rate-contracts/rate-contract-schema";
import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.order.view", async (client, context) => ({ contract: await getRateContract(client, context, id) }));
}

// Changes a draft.
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.price_lists.manage_prices", rateContractSchema, async (client, context, input) => ({ contract: await saveRateContract(client, context, input, id) }));
}

// { action: "activate" | "close" | "cancel" }
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.price_lists.manage_prices", z.object({ action: z.enum(["activate", "close", "cancel"]) }),
    async (client, context, input) => ({ contract: await setRateContractStatus(client, context, id, input.action) }));
}
