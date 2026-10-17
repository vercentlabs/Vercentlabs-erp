import { getOpeningBatch } from "@vercentlabs/api";

import { assetsRead } from "@/features/assets/shared/route-helpers";

// One migration batch with its rows (?rowStatus=&search=), opening positions and what the person may do.
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  const url = new URL(request.url);
  return assetsRead(request, (client, context) => getOpeningBatch(client, context, id, { rowStatus: url.searchParams.get("rowStatus") ?? undefined, search: url.searchParams.get("search") ?? undefined }));
}
