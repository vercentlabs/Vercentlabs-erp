import { getQualityControlPoint, getQualityControlPointHistory } from "@vercentlabs/api";

import { qualityRead } from "@/features/quality/shared/route-helpers";

// One quality control point (?versionId=), or its trigger and audit history (?part=history).
type Params = { params: Promise<{ pointId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { pointId } = await ctx.params;
  const q = new URL(request.url).searchParams;
  return qualityRead(request, async (client, context) =>
    q.get("part") === "history" ? getQualityControlPointHistory(client, context, pointId) : getQualityControlPoint(client, context, pointId, { versionId: q.get("versionId") || null }));
}
