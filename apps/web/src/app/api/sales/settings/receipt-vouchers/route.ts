import { z } from "zod";

import { setReceiptVouchersFrom } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Receipt vouchers for advances from a date (null: off). Payments before that date are never touched.
export async function POST(request: Request) {
  return salesMutation(request, "sales.settings.manage", z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }), async (client, context, input) =>
    setReceiptVouchersFrom(client, context, input.from));
}
