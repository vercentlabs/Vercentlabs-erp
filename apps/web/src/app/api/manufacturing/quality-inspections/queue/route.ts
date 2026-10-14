import { getInspectionQueue } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// The inspection queue: reported output awaiting inspection, entry by entry, with what is held and any open inspection (?orderId=&itemId=).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["orderId", "itemId"].map((key) => [key, url.searchParams.get(key) || undefined]));
  return manufacturingRead(request, async (client, context) => ({ queue: await getInspectionQueue(client, context, filters) }));
}
