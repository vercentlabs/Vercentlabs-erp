import { z } from "zod";

import { listReminderLog, setCustomerRemindersPaused } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// The customer's payment reminders: what was sent, and whether they are paused.
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.view", async (client, context) => {
    const paused = (await client.query("SELECT payment_reminders_paused FROM tenant.business_parties WHERE organization_id = $1 AND id = $2", [context.organizationId, id])).rows[0];
    return { paused: Boolean(paused?.payment_reminders_paused), ...(await listReminderLog(client, context, { partyId: id, limit: 20 })) };
  });
}

// { paused }: leave the customer out of automatic reminders, or bring them back.
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.view", z.object({ paused: z.boolean() }), async (client, context, input) => setCustomerRemindersPaused(client, context, id, input.paused));
}
