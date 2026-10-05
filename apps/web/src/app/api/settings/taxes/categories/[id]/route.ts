import { z } from "zod";

import { getTaxCategory, updateTaxCategory } from "@vercentlabs/api";

import { taxRead, taxWrite } from "@/features/settings/taxes/server/tax-http";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return taxRead(request, "tax.view", async (client, context) => ({ category: await getTaxCategory(client, context, id) }));
}

// The rate is changed through …/rate; the code, type and treatment only while the category is unused.
const schema = z.object({
  code: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullish(),
  taxType: z.string().max(20).optional(),
  treatment: z.string().max(20).optional(),
  appliesTo: z.string().max(20).optional(),
  reverseCharge: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return taxWrite(request, "tax.categories.manage", schema, async (client, context, input) => ({ category: await updateTaxCategory(client, context, id, input) }));
}
