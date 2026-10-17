import { getAssignmentRequest } from "@vercentlabs/api";

import { assetsRead } from "@/features/assets/shared/route-helpers";

// One assignment request, with the asset's current custody read back from the Custodian records.
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return assetsRead(request, (client, context) => getAssignmentRequest(client, context, id));
}
