import { prepareProjectFileUpload, uploadCommentAttachment } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { toWire } from "@/core/wire";
import { workspaceRoute } from "@/core/workspace-route";
import { projectsContext } from "@/features/projects/shared/projects-context";
import { readUpload } from "@/features/procurement/suppliers/server/supplier-http";

// A file uploaded to one's own comment (multipart: file). The comment's record decides who may read it.
type Params = { params: Promise<{ commentId: string }> };
export async function POST(request: Request, ctx: Params) {
  const { commentId } = await ctx.params;
  return workspaceRoute(request, { module: "projects", permission: "projects.comments.attach", billingWrite: true }, async ({ client, session }) => {
    const upload = await readUpload(request);
    const prepared = await prepareProjectFileUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return ok(toWire({ file: await uploadCommentAttachment(client, projectsContext(session), commentId, { prepared }) }) as Record<string, unknown>, 201);
  });
}
