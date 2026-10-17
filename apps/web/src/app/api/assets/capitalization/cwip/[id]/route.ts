import { getCwipProject } from "@vercentlabs/api";

import { assetsRead } from "@/features/assets/shared/route-helpers";

// One CWIP project: its costs, Finance requests and transfers.
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return assetsRead(request, (client, context) => getCwipProject(client, context, id));
}
