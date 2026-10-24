import { listCheques } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// The cheque register (Sales report Phase 2): ?view=all|in_hand|post_dated|deposited|cleared|bounced|cancelled&q=&partyId=
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return salesRead(request, "sales.view", async (client, context) =>
    listCheques(client, context, { view: params.get("view") ?? "all", search: params.get("q") ?? undefined, partyId: params.get("partyId") ?? undefined }));
}
