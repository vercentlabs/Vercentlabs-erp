import { listDispatchExceptions } from "@vercentlabs/api";

import { qualityRead } from "@/features/quality/shared/route-helpers";

// Delivery lines held by a configuration exception, inspections needing recovery, rejected units not yet on an Inventory hold.
export async function GET(request: Request) {
  return qualityRead(request, async (client, context) => ({ rows: await listDispatchExceptions(client, context) }), "quality.dispatch.view");
}
