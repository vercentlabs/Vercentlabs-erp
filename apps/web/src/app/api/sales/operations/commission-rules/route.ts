import { z } from "zod";

import { createSalesCommissionRule } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

const schema = z.object({
  name: z.string().trim().min(1).max(200),
  ratePercent: z.union([z.number(), z.string()]),
  basis: z.enum(["net_sales", "gross_margin"]).optional(),
  ownerUserId: z.string().uuid().nullish(),
  companyId: z.string().uuid().nullish(),
  validFrom: z.string().date().nullish(),
  validTo: z.string().date().nullish(),
});

export async function POST(request: Request) {
  return salesMutation(request, "sales.settings.manage", schema, async (client, context, input) => ({ rule: await createSalesCommissionRule(client, context, input) }), 201);
}
