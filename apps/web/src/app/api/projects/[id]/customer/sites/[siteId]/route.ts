import { removeProjectSite, updateProjectSite } from "@vercentlabs/api";
import { z } from "zod";

import { siteFields } from "@/features/projects/shared/schemas";
import { projectsMutation } from "@/features/projects/shared/route-helpers";

type Params = { params: Promise<{ id: string; siteId: string }> };
export async function PATCH(request: Request, ctx: Params) {
  const { id, siteId } = await ctx.params;
  return projectsMutation(request, z.object({ ...siteFields, siteName: z.string().max(120).optional(), expectedVersion: z.number().int().optional() }), async (client, context, input) =>
    updateProjectSite(client, context, id, siteId, input));
}
export async function DELETE(request: Request, ctx: Params) {
  const { id, siteId } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context) => removeProjectSite(client, context, id, siteId));
}
