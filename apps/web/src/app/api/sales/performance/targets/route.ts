import { z } from "zod";

import { setInvoicedTarget } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// A salesperson's monthly target of invoiced value (company currency); 0 clears it.
const schema = z.object({ userId: z.string().uuid(), month: z.string().regex(/^\d{4}-\d{2}$/), target: z.number().min(0) });

export async function POST(request: Request) {
  return salesMutation(request, "sales.settings.manage", schema, async (client, context, input) => ({ result: await setInvoicedTarget(client, context, input) }));
}
