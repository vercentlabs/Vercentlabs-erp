import { z } from "zod";

import { changeTaxRate } from "@vercentlabs/api";

import { taxWrite } from "@/features/settings/taxes/server/tax-http";

// Ends the current rate the day before and starts the new one on the date given.
const schema = z.object({ rate: z.number().min(0).max(100), cessRate: z.number().min(0).max(1000).nullish(), effectiveFrom: z.string().date() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return taxWrite(request, "tax.rates.manage", schema, async (client, context, input) => ({ category: await changeTaxRate(client, context, id, input) }));
}
