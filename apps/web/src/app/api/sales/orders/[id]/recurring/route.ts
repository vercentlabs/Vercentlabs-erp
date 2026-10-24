import { getRecurringSchedule, saveRecurringSchedule } from "@vercentlabs/api";

import { recurringScheduleSchema } from "@/features/sales/orders/recurring-schema";
import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// The order's recurring schedule and its last runs (Sales report Phase 3).
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.order.view", async (client, context) => getRecurringSchedule(client, context, id));
}

// Sets up the schedule, or changes the one the order has.
export async function PUT(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.create", recurringScheduleSchema, async (client, context, input) => saveRecurringSchedule(client, context, id, input));
}
