import { getManufacturingScrap, updateScrapDraft } from "@vercentlabs/api";

import { scrapEditSchema } from "@/features/manufacturing/scrap/api/scrap-schemas";
import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// One scrap note: lines and identities, value, approval, posting, corrections and timeline.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingRead(request, async (client, context) => ({ scrap: await getManufacturingScrap(client, context, id) }));
}

// Edit an unposted note under its version (an edit withdraws an approval).
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingMutation(request, scrapEditSchema, async (client, context, input) => ({ scrap: await updateScrapDraft(client, context, id, input) }));
}
