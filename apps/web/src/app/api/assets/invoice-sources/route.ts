import { listEligibleInvoices } from "@vercentlabs/api";

import { assetsRead } from "@/features/assets/shared/route-helpers";

// Supplier invoices with asset lines still to register (?search=).
export async function GET(request: Request) {
  const url = new URL(request.url);
  return assetsRead(request, (client, context) => listEligibleInvoices(client, context, { search: url.searchParams.get("search") ?? undefined }));
}
