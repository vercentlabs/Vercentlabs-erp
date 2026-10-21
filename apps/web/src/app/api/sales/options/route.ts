import { getSalesOptions } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// The form's options: a first page of customers and products with the document's own (?partyId=, ?itemIds=a,b) always included, and the
// chosen customer's contacts and addresses (Sales audit B4).
export async function GET(request: Request) {
  const url = new URL(request.url);
  return salesRead(request, "sales.view", async (client, context) => ({
    options: await getSalesOptions(
      client,
      context,
      url.searchParams.get("opportunityId"),
      url.searchParams.get("partyId"),
      { itemIds: (url.searchParams.get("itemIds") ?? "").split(",").filter(Boolean) },
    ),
  }));
}
