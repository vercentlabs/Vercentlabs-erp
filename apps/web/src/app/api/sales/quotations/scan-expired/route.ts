import { scanExpiredQuotations } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";
import { emptySchema } from "@/features/sales/shared/schemas";

export async function POST(request: Request) {
  return salesMutation(request, "sales.settings.manage", emptySchema, async (client, context) => ({ result: await scanExpiredQuotations(client, context) }));
}
