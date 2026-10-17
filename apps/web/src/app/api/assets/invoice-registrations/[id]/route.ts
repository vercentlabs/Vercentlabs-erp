import { getInvoiceRegistrationBatch } from "@vercentlabs/api";

import { assetsRead } from "@/features/assets/shared/route-helpers";

// One registration: its lines, results and the assets it created as they are now.
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return assetsRead(request, (client, context) => getInvoiceRegistrationBatch(client, context, id));
}
