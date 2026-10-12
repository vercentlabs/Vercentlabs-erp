import { getPosReprintSummary } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET ?from=&to=: receipt reprints in the period (this month by default) — by person, by reason, how they ended, documents copied often.
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  return posRead(request, async (client, context) => ({
    summary: await getPosReprintSummary(client, context, { from: search.get("from") ?? undefined, to: search.get("to") ?? undefined }),
  }), "pos.view");
}
