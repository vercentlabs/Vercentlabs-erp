import { compareQuotationVersions } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const left = url.searchParams.get("left") ?? "";
  const right = url.searchParams.get("right") ?? "";
  return salesRead("sales.view", async (client, context) => ({ comparison: await compareQuotationVersions(client, context, id, left, right) }));
}
