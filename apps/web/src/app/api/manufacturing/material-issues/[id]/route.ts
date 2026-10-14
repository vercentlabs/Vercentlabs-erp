import { getMaterialIssue, updateMaterialIssueDraft } from "@vercentlabs/api";

import { issueEditSchema } from "@/features/manufacturing/issues/api/mi-schemas";
import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// One material issue note: lines, stock taken (or to take), approval, posting, reversals and timeline.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingRead(request, async (client, context) => ({ issue: await getMaterialIssue(client, context, id) }));
}

// Edit an unposted note under its version (an edit withdraws an approval).
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingMutation(request, issueEditSchema, async (client, context, input) => ({ issue: await updateMaterialIssueDraft(client, context, id, input) }));
}
