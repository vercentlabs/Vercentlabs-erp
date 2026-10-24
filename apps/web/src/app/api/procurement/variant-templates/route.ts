import { searchPurchaseVariantTemplates } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// Items bought in variants (sizes, colours), for the variant grid on purchase orders: ?q=
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams.get("q") ?? "";
  return procurementRead(request, async (client, context) => searchPurchaseVariantTemplates(client, context, { search }));
}
