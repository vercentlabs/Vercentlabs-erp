import { z } from "zod";

import { setRecurringScheduleStatus } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// { action }: pause, resume or end the schedule.
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.create", z.object({ action: z.enum(["pause", "resume", "end"]) }),
    async (client, context, input) => setRecurringScheduleStatus(client, context, id, input.action));
}
