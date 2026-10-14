import { createQualityTemplateRevision } from "@vercentlabs/api";

import { revisionSchema } from "@/features/manufacturing/quality/api/qi-schemas";
import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

// A new revision in force from now; the one before is superseded (inspections keep the revision they used).
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingMutation(request, revisionSchema, async (client, context, input) => ({ template: await createQualityTemplateRevision(client, context, id, input) }), 201);
}
