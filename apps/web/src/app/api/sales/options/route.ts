import { getSalesOptions } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

export async function GET(request: Request) {
  const url = new URL(request.url);
  return salesRead("sales.view", async (client, context) => ({
    options: await getSalesOptions(client, context, url.searchParams.get("opportunityId"), url.searchParams.get("partyId")),
  }));
}
