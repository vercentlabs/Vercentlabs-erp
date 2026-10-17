import { recoverTimeBillingOperation } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// Whether a billing command sent with this key was applied (?key=).
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => ({ outcome: await recoverTimeBillingOperation(client, context, { idempotencyKey: url.searchParams.get("key") ?? undefined }) }));
}
