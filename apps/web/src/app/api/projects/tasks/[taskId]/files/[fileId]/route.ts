import { readTaskFile, removeTaskFile } from "@vercentlabs/api";
import { z } from "zod";

import { workspaceRoute } from "@/core/workspace-route";
import { projectsContext } from "@/features/projects/shared/projects-context";
import { projectsMutation } from "@/features/projects/shared/route-helpers";

// One task file: download it (through the task, never by link alone) or remove it (not once it was reviewed or the task is done).
type Params = { params: Promise<{ taskId: string; fileId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { taskId, fileId } = await ctx.params;
  return workspaceRoute(request, { module: "projects", permission: "projects.tasks.view" }, async ({ client, session }) => {
    const file = await readTaskFile(client, projectsContext(session), taskId, fileId);
    return new Response(new Uint8Array(file.body), {
      headers: {
        "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Content-Length": String(file.body.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
export async function DELETE(request: Request, ctx: Params) {
  const { taskId, fileId } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context) => removeTaskFile(client, context, taskId, fileId), 200, "projects.tasks.view");
}
