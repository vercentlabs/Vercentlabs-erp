import { getCapitalization } from "@vercentlabs/api";

import { assetsRead } from "@/features/assets/shared/route-helpers";

// One capitalization request: its components, journal, history and what the person may do.
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return assetsRead(request, (client, context) => getCapitalization(client, context, id));
}
