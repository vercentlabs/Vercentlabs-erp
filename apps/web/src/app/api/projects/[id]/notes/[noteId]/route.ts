import { editProjectNote, removeProjectNote } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation } from "@/features/projects/shared/route-helpers";

type Params = { params: Promise<{ id: string; noteId: string }> };
export async function PATCH(request: Request, ctx: Params) {
  const { id, noteId } = await ctx.params;
  return projectsMutation(request, z.object({ body: z.string().min(1).max(5000), expectedVersion: z.number().int().optional() }), async (client, context, input) => editProjectNote(client, context, id, noteId, input));
}
export async function DELETE(request: Request, ctx: Params) {
  const { id, noteId } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context) => removeProjectNote(client, context, id, noteId));
}
