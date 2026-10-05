import { z } from "zod";

import { createTaxCategory } from "@vercentlabs/api";

import { taxWrite } from "@/features/settings/taxes/server/tax-http";

const schema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullish(),
  taxType: z.string().max(20).optional(),
  treatment: z.string().max(20).optional(),
  appliesTo: z.string().max(20).optional(),
  reverseCharge: z.boolean().optional(),
  rate: z.number().min(0).max(100).nullish(),
  cessRate: z.number().min(0).max(1000).nullish(),
  effectiveFrom: z.string().date().nullish(),
});

export async function POST(request: Request) {
  return taxWrite(request, "tax.categories.manage", schema, async (client, context, input) => ({ category: await createTaxCategory(client, context, input) }), 201);
}
