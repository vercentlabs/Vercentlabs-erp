import { readMilestoneFile, removeMilestoneFile } from "@vercentlabs/api";
import { z } from "zod";

import { workspaceRoute } from "@/core/workspace-route";
import { projectsContext } from "@/features/projects/shared/projects-context";
import { projectsMutation } from "@/features/projects/shared/route-helpers";

// One milestone file: download it (through the milestone, never by link alone) or remove it (not while it is evidence).
type Params = { params: Promise<{ milestoneId: string; fileId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { milestoneId, fileId } = await ctx.params;
  return workspaceRoute(request, { module: "projects", permission: "projects.milestones.view" }, async ({ client, session }) => {
    const file = await readMilestoneFile(client, projectsContext(session), milestoneId, fileId);
    return new Response(new Uint8Array(file.body), {
      headers: {
        "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Content-Length": String(file.body.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
export async function DELETE(request: Request, ctx: Params) {
  const { milestoneId, fileId } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context) => removeMilestoneFile(client, context, milestoneId, fileId), 200, "projects.milestones.view");
}
