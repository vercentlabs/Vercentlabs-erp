import { editComment, softDeleteComment } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation } from "@/features/projects/shared/route-helpers";

// One comment: PATCH edits one's own (within the window; a version is kept) · DELETE removes it (one's own, or a moderator with a reason).
type Params = { params: Promise<{ commentId: string }> };
const editSchema = z.object({ body: z.string().max(40000), mentionUserIds: z.array(z.string().max(64)).max(50).optional(), expectedVersion: z.number().int().optional(), reason: z.string().max(500).optional() });
export async function PATCH(request: Request, ctx: Params) {
  const { commentId } = await ctx.params;
  return projectsMutation(request, editSchema, async (client, context, input) => editComment(client, context, commentId, input), 200, "projects.comments.view");
}
const deleteSchema = z.object({ reason: z.string().max(500).optional(), expectedVersion: z.number().int().optional() });
export async function DELETE(request: Request, ctx: Params) {
  const { commentId } = await ctx.params;
  return projectsMutation(request, deleteSchema, async (client, context, input) => softDeleteComment(client, context, commentId, input), 200, "projects.comments.view");
}
