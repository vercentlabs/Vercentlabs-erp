import { getQualityTemplate, setQualityTemplateStatus } from "@vercentlabs/api";

import { templateStatusSchema } from "@/features/manufacturing/quality/api/qi-schemas";
import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// One checklist with its revisions.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingRead(request, async (client, context) => ({ template: await getQualityTemplate(client, context, id) }));
}

// Make it active or inactive.
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingMutation(request, templateStatusSchema, async (client, context, input) => ({ template: await setQualityTemplateStatus(client, context, id, input) }));
}
