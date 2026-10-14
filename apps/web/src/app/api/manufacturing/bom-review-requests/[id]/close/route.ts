import { closeBomReviewRequest } from "@vercentlabs/api";
import { z } from "zod";

import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

// Close a BOM review request with what engineering decided (a new revision follows the BOM workflow on its own).
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingMutation(request, z.object({ note: z.string().max(1000) }), async (client, context, input) => closeBomReviewRequest(client, context, id, input));
}
