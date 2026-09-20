import { z } from "zod";

import { linkSupplierAccountingParty } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";

const schema = z.object({ supplierId: z.string().uuid(), accountingPartyId: z.string().uuid() });

export async function POST(request: Request) {
  return procurementMutation(request, schema, async (client, context, input) => ({ supplier: await linkSupplierAccountingParty(client, context, input) }));
}
