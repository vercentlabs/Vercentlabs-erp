import { z } from "zod";

import { setTaxCategoryStatus } from "@vercentlabs/api";

import { taxWrite } from "@/features/settings/taxes/server/tax-http";

const schema = z.object({ active: z.boolean() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return taxWrite(request, "tax.categories.manage", schema, async (client, context, input) => ({ category: await setTaxCategoryStatus(client, context, id, input.active) }));
}
