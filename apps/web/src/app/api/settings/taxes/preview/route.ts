import { z } from "zod";

import { previewTaxCalculation } from "@vercentlabs/api";

import { taxWrite } from "@/features/settings/taxes/server/tax-http";

const schema = z.object({
  taxCategoryId: z.string().uuid(),
  amount: z.union([z.string(), z.number()]),
  priceIncludesTax: z.boolean().optional(),
  sellerRegistrationId: z.string().uuid().nullish(),
  placeOfSupply: z.string().trim().max(2).nullish(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

// A sample calculation through the shared tax engine (changes nothing).
export async function POST(request: Request) {
  return taxWrite(request, "tax.view", schema, async (client, context, input) => ({ preview: await previewTaxCalculation(client, context, input) }));
}
