import { closeContractLine } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation } from "@/features/projects/shared/route-helpers";

// A contract line stops authorizing new time (a rate revision is a new line).
type Params = { params: Promise<{ lineId: string }> };
const schema = z.object({ reason: z.string().max(500) });
export async function POST(request: Request, ctx: Params) {
  const { lineId } = await ctx.params;
  return projectsMutation(request, schema, async (client, context, input) => closeContractLine(client, context, lineId, input));
}
