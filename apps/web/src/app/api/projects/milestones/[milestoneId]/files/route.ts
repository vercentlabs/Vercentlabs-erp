import { listMilestoneFiles, prepareProjectFileUpload, uploadMilestoneFile } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { toWire } from "@/core/wire";
import { workspaceRoute } from "@/core/workspace-route";
import { projectsContext } from "@/features/projects/shared/projects-context";
import { projectsRead } from "@/features/projects/shared/route-helpers";
import { readUpload } from "@/features/procurement/suppliers/server/supplier-http";

// A milestone's files: deliverables and the evidence for them or for the customer's decision. Multipart: file.
type Params = { params: Promise<{ milestoneId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { milestoneId } = await ctx.params;
  return projectsRead(request, async (client, context) => ({ files: await listMilestoneFiles(client, context, milestoneId) }), "projects.milestones.view");
}
export async function POST(request: Request, ctx: Params) {
  const { milestoneId } = await ctx.params;
  return workspaceRoute(request, { module: "projects", permission: "projects.milestones.view", billingWrite: true }, async ({ client, session }) => {
    const upload = await readUpload(request);
    const prepared = await prepareProjectFileUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return ok(toWire({ file: await uploadMilestoneFile(client, projectsContext(session), milestoneId, { prepared }) }) as Record<string, unknown>, 201);
  });
}
