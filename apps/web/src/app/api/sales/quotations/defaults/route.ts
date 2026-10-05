import { getQuotationDefaults } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// What a new quotation starts with, for the chosen customer.
export async function GET(request: Request) {
  const partyId = new URL(request.url).searchParams.get("partyId");
  return salesRead(request, "sales.quotation.create", async (client, context) => ({ defaults: await getQuotationDefaults(client, context, { partyId }) }));
}
