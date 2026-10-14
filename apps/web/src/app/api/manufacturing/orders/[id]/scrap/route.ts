import { getMoScrapHistory, getScrappableSources } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// GET the order's scrap notes (its scrap history); ?view=sources returns what it can scrap now (material in custody, rejected output).
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const view = new URL(request.url).searchParams.get("view");
  return manufacturingRead(request, async (client, context) => (view === "sources" ? { sources: await getScrappableSources(client, context, id) } : { scraps: await getMoScrapHistory(client, context, id) }));
}
