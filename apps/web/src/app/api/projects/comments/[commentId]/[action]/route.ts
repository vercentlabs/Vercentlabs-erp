import { attachFileToComment, getCommentHistory, replyToComment } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

type Params = { params: Promise<{ commentId: string; action: string }> };
// GET history
export async function GET(request: Request, ctx: Params) {
  const { commentId, action } = await ctx.params;
  return projectsRead(request, async (client, context) => {
    if (action === "history") return { history: await getCommentHistory(client, context, commentId) };
    throw new HttpError(404, "Unknown comment view.", "NOT_FOUND");
  }, "projects.comments.view");
}
// POST reply { body, mentionUserIds?, attachmentIds?, idempotencyKey? } · attach { attachmentIds } (files already on the record)
export async function POST(request: Request, ctx: Params) {
  const { commentId, action } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    if (action === "reply") return replyToComment(client, context, commentId, input);
    if (action === "attach") return attachFileToComment(client, context, commentId, input);
    throw new HttpError(404, "Unknown comment action.", "NOT_FOUND");
  }, 200, "projects.comments.view");
}
