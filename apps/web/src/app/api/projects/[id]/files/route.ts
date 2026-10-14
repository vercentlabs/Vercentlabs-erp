import { listProjectFiles, prepareProjectFileUpload, uploadProjectFile } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { toWire } from "@/core/wire";
import { workspaceRoute } from "@/core/workspace-route";
import { projectsContext } from "@/features/projects/shared/projects-context";
import { projectsRead } from "@/features/projects/shared/route-helpers";
import { readUpload } from "@/features/procurement/suppliers/server/supplier-http";

// Project documents. Multipart: file.
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsRead(request, async (client, context) => ({ files: await listProjectFiles(client, context, id) }));
}
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return workspaceRoute(request, { module: "projects", permission: "projects.view", billingWrite: true }, async ({ client, session }) => {
    const upload = await readUpload(request);
    const prepared = await prepareProjectFileUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return ok(toWire({ file: await uploadProjectFile(client, projectsContext(session), id, { prepared }) }) as Record<string, unknown>, 201);
  });
}
