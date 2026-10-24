import { getJobWork } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { procurementContext } from "@/features/procurement/shared/procurement-context";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return workspaceRoute(request, { module: "procurement", permission: "procurement.view" }, async ({ client, session }) =>
    Response.json({ jobWork: await getJobWork(client, procurementContext(session), id) }));
}
