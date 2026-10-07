import { calculateVendorCreditTotals } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// What a credit would be — lines, tax components, withholding and totals from the server's calculation — without recording anything.
export async function POST(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context, input) => calculateVendorCreditTotals(client, context, input as Record<string, unknown>), 200, "procurement.view");
}
