import { getInvoiceSource } from "@vercentlabs/api";

import { assetsRead } from "@/features/assets/shared/route-helpers";

// One invoice: header, lines with what can still be registered, the assets linked to it and its registrations.
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return assetsRead(request, (client, context) => getInvoiceSource(client, context, id));
}
