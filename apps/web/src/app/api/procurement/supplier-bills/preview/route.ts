import { previewSupplierBill } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// What a bill would be — the server's amounts, matching and duplicates — without recording it.
export async function POST(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ preview: await previewSupplierBill(client, context, input) }), 200, "procurement.bills.view");
}
