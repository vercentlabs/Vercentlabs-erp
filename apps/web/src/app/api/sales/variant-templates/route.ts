import { searchVariantTemplates } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// Products sold in variants (sizes, colours), for the variant grid (Sales report Phase 3): ?q=
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams.get("q") ?? "";
  return salesRead(request, "sales.view", async (client, context) => searchVariantTemplates(client, context, { search }));
}
