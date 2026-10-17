import { readCommentAttachment, removeCommentAttachment } from "@vercentlabs/api";
import { z } from "zod";

import { workspaceRoute } from "@/core/workspace-route";
import { projectsContext } from "@/features/projects/shared/projects-context";
import { projectsMutation } from "@/features/projects/shared/route-helpers";

// A comment's file: download it (through the comment and its record, never by link alone) or remove it.
type Params = { params: Promise<{ commentId: string; fileId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { commentId, fileId } = await ctx.params;
  return workspaceRoute(request, { module: "projects", permission: "projects.comments.view" }, async ({ client, session }) => {
    const file = await readCommentAttachment(client, projectsContext(session), commentId, fileId);
    return new Response(new Uint8Array(file.body), {
      headers: {
        "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Content-Length": String(file.body.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
export async function DELETE(request: Request, ctx: Params) {
  const { commentId, fileId } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context) => removeCommentAttachment(client, context, commentId, fileId), 200, "projects.comments.view");
}
