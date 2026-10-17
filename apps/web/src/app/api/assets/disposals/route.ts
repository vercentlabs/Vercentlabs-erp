import { getDisposalOverview } from "@vercentlabs/api";

import { assetsRead } from "@/features/assets/shared/route-helpers";

// GET the Disposals workspace overview: drafts, pending approval, approved, assets pending handover or Finance, completed, exceptions.
export async function GET(request: Request) {
  return assetsRead(request, (client, context) => getDisposalOverview(client, context));
}
