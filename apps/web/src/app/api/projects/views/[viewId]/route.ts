import { removeProjectView } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation } from "@/features/projects/shared/route-helpers";

export async function DELETE(request: Request, ctx: { params: Promise<{ viewId: string }> }) {
  const { viewId } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context) => removeProjectView(client, context, viewId));
}
