import { removeProjectMember, updateProjectMemberRole } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation } from "@/features/projects/shared/route-helpers";

type Params = { params: Promise<{ id: string; memberId: string }> };
export async function PATCH(request: Request, ctx: Params) {
  const { id, memberId } = await ctx.params;
  return projectsMutation(request, z.object({ role: z.enum(["MEMBER", "VIEWER", "FINANCIAL_VIEWER"]) }), async (client, context, input) => updateProjectMemberRole(client, context, id, memberId, input));
}
// The person leaves the project; their history stays.
export async function DELETE(request: Request, ctx: Params) {
  const { id, memberId } = await ctx.params;
  return projectsMutation(request, z.object({ note: z.string().max(500).optional(), reassignToUserId: z.string().uuid().optional(), taskException: z.string().max(2000).optional() }), async (client, context, input) => removeProjectMember(client, context, id, memberId, input));
}
