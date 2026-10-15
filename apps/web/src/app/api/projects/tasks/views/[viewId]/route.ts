import { removeTaskView } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation } from "@/features/projects/shared/route-helpers";

type Params = { params: Promise<{ viewId: string }> };
export async function DELETE(request: Request, ctx: Params) {
  const { viewId } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context) => removeTaskView(client, context, viewId), 200, "projects.tasks.view");
}
