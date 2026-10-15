import { listTaskFiles, prepareProjectFileUpload, uploadTaskFile } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { toWire } from "@/core/wire";
import { workspaceRoute } from "@/core/workspace-route";
import { projectsContext } from "@/features/projects/shared/projects-context";
import { projectsRead } from "@/features/projects/shared/route-helpers";
import { readUpload } from "@/features/procurement/suppliers/server/supplier-http";

// A task's files: instructions, deliverables and completion evidence. Multipart: file.
type Params = { params: Promise<{ taskId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { taskId } = await ctx.params;
  return projectsRead(request, async (client, context) => ({ files: await listTaskFiles(client, context, taskId) }), "projects.tasks.view");
}
export async function POST(request: Request, ctx: Params) {
  const { taskId } = await ctx.params;
  return workspaceRoute(request, { module: "projects", permission: "projects.tasks.view", billingWrite: true }, async ({ client, session }) => {
    const upload = await readUpload(request);
    const prepared = await prepareProjectFileUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return ok(toWire({ file: await uploadTaskFile(client, projectsContext(session), taskId, { prepared }) }) as Record<string, unknown>, 201);
  });
}
