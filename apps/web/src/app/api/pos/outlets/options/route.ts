import { getOutletOptions } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// Types, payment methods, members, warehouses and locations, GST registrations, price lists, customers, accounts and defaults.
export async function GET(request: Request) {
  return posRead(request, (client, context) => getOutletOptions(client, context));
}
