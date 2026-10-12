import { getShiftOpeningContext } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// GET ?terminalId=: opening a shift — the company, your counters (free or taken), your open shift if any, and the chosen counter's readiness.
export async function GET(request: Request) {
  const terminalId = new URL(request.url).searchParams.get("terminalId") || undefined;
  return posRead(request, async (client, context) => ({ context: await getShiftOpeningContext(client, context, { terminalId }) }), "pos.view");
}
