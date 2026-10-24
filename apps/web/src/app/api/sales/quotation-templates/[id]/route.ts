import { z } from "zod";

import { deleteQuotationTemplate, getQuotationTemplate, setQuotationTemplateActive, updateQuotationTemplate } from "@vercentlabs/api";

import { quotationTemplateSchema } from "@/features/sales/quotations/template-schema";
import { emptySchema } from "@/features/sales/shared/schemas";
import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.view", async (client, context) => getQuotationTemplate(client, context, id));
}

export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.settings.manage", quotationTemplateSchema, async (client, context, input) => updateQuotationTemplate(client, context, id, input));
}

// { active }: switch the template on or off.
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.settings.manage", z.object({ active: z.boolean() }), async (client, context, input) => setQuotationTemplateActive(client, context, id, input.active));
}

export async function DELETE(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.settings.manage", emptySchema, async (client, context) => deleteQuotationTemplate(client, context, id));
}
