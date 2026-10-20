import { listIncomingExceptions } from "@vercentlabs/api";

import { qualityRead } from "@/features/quality/shared/route-helpers";

// Source conflicts and loose ends: missing standards, conflicting control points, reversed receipts, recovery, cleared stock not yet released.
export async function GET(request: Request) {
  return qualityRead(request, async (client, context) => ({ rows: await listIncomingExceptions(client, context) }), "quality.incoming.view");
}
