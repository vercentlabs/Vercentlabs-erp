import { z } from "zod";

import { accrueSalesCommission } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

const schema = z.object({ salesOrderId: z.string().uuid(), ruleId: z.string().uuid().nullish(), ownerUserId: z.string().uuid().nullish() });

export async function POST(request: Request) {
  return salesMutation(request, "sales.settings.manage", schema, async (client, context, input) => ({ commission: await accrueSalesCommission(client, context, input) }), 201);
}
