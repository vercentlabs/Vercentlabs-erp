import { listTaxHistory } from "@vercentlabs/api";

import { taxRead } from "@/features/settings/taxes/server/tax-http";

export async function GET(request: Request) {
  const url = new URL(request.url);
  return taxRead(request, "tax.audit.view", async (client, context) => ({
    history: await listTaxHistory(client, context, { entityType: url.searchParams.get("entityType") ?? undefined, entityId: url.searchParams.get("entityId") ?? undefined }),
  }));
}
