import { z } from "zod";

import { deleteReminderRule, saveReminderRule, setReminderRuleActive } from "@vercentlabs/api";

import { reminderRuleSchema } from "@/features/sales/settings/reminder-schema";
import { emptySchema } from "@/features/sales/shared/schemas";
import { salesMutation } from "@/features/sales/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.settings.manage", reminderRuleSchema, async (client, context, input) => saveReminderRule(client, context, input, id));
}

// { active }: switch the rule on or off.
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.settings.manage", z.object({ active: z.boolean() }), async (client, context, input) => setReminderRuleActive(client, context, id, input.active));
}

export async function DELETE(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.settings.manage", emptySchema, async (client, context) => deleteReminderRule(client, context, id));
}
