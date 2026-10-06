import { searchSuppliers } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// The supplier picker: inactive and blocked suppliers are returned marked, never selectable.
export async function GET(request: Request) {
  const url = new URL(request.url);
  return procurementRead(request, async (client, context) => ({
    suppliers: await searchSuppliers(client, context, { search: url.searchParams.get("search") ?? "", limit: Number(url.searchParams.get("limit") ?? 20) }),
  }));
}
