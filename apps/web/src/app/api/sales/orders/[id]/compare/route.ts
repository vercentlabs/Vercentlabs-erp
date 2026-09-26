import { compareSalesOrderVersions } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { salesRead } from "@/features/sales/shared/route-helpers";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const left = url.searchParams.get("left");
  const right = url.searchParams.get("right");
  return salesRead(request, "sales.view", async (client, context) => {
    if (!left || !right) throw new HttpError(400, "Both versions to compare are required.");
    return { comparison: await compareSalesOrderVersions(client, context, id, left, right) };
  });
}
