import { readProjectFile, removeProjectFile } from "@vercentlabs/api";
import { z } from "zod";

import { workspaceRoute } from "@/core/workspace-route";
import { projectsContext } from "@/features/projects/shared/projects-context";
import { projectsMutation } from "@/features/projects/shared/route-helpers";

// One document: download it (through the project, never by link alone) or remove it.
type Params = { params: Promise<{ id: string; fileId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id, fileId } = await ctx.params;
  return workspaceRoute(request, { module: "projects", permission: "projects.view" }, async ({ client, session }) => {
    const file = await readProjectFile(client, projectsContext(session), id, fileId);
    return new Response(new Uint8Array(file.body), {
      headers: {
        "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Content-Length": String(file.body.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
export async function DELETE(request: Request, ctx: Params) {
  const { id, fileId } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context) => removeProjectFile(client, context, id, fileId));
}
