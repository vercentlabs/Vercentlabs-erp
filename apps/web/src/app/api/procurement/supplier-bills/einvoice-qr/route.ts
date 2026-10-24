import { checkEInvoiceQr } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// The supplier's e-invoice QR, read and checked: { qr } → what it says, the supplier with its GSTIN, and any problem. Nothing is saved.
export async function POST(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await checkEInvoiceQr(client, context, { qr: String((input as { qr?: unknown }).qr ?? "") }) }),
    200, "procurement.bills.view");
}
