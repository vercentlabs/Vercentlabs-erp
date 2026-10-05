import { z } from "zod";

import { updateTaxSettings } from "@vercentlabs/api";

import { taxWrite } from "@/features/settings/taxes/server/tax-http";

// With tax switched off, no document is taxed.
const schema = z.object({ taxEnabled: z.boolean().optional(), defaultTaxCategoryId: z.string().uuid().nullable().optional() });

export async function PUT(request: Request) {
  return taxWrite(request, "tax.registrations.manage", schema, async (client, context, input) => ({ settings: await updateTaxSettings(client, context, input) }));
}
