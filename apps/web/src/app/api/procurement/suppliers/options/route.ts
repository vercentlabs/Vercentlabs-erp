import { getSupplierFormOptions } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

export async function GET(request: Request) {
  return procurementRead(request, async (client, context) => ({ options: await getSupplierFormOptions(client, context) }));
}
