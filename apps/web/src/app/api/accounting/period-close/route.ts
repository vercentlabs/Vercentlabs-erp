import { getCloseOverview } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

// The financial years and their months, where each stands, and the month next to close.
export async function GET(request: Request) {
  return accountingRead(request, async (client, context) => ({ overview: await getCloseOverview(client, context) }));
}
