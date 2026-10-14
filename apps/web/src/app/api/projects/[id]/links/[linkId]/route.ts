import { unlinkProjectRecord } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation } from "@/features/projects/shared/route-helpers";

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string; linkId: string }> }) {
  const { id, linkId } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context) => unlinkProjectRecord(client, context, id, linkId));
}
