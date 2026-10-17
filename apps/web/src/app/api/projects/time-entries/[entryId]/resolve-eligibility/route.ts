import { resolveTimeEligibility } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation } from "@/features/projects/shared/route-helpers";

// Approved billable time that waited for its contract line is billed on a valid one.
type Params = { params: Promise<{ entryId: string }> };
const schema = z.object({ contractLineId: z.string().uuid().optional() });
export async function POST(request: Request, ctx: Params) {
  const { entryId } = await ctx.params;
  return projectsMutation(request, schema, async (client, context, input) => resolveTimeEligibility(client, context, entryId, input));
}
