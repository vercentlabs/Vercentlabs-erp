import { z } from "zod";

import { saveCommissionRule, setCommissionRuleStatus } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

import { commissionRuleSchema as ruleSchema } from "@/features/sales/settings/commission-schema";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.settings.manage", ruleSchema, async (client, context, input) => ({ rule: await saveCommissionRule(client, context, input, id) }));
}

// { active }: switch the rule on or off.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.settings.manage", z.object({ active: z.boolean() }), async (client, context, input) => ({ result: await setCommissionRuleStatus(client, context, id, input.active) }));
}
