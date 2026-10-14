import { getManufacturingBom } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// One BOM: its revisions, the chosen revision (?revisionId=) with lines and problems, where it is used and its history.
export async function GET(request: Request, ctx: { params: Promise<{ bomId: string }> }) {
  const { bomId } = await ctx.params;
  const revisionId = new URL(request.url).searchParams.get("revisionId");
  return manufacturingRead(request, async (client, context) => ({ bom: await getManufacturingBom(client, context, bomId, { revisionId }) }));
}
