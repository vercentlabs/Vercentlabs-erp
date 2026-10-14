import { getVarianceReviewQueue } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// The review queue: open exceptions, and lines of live orders that need review but have no exception yet.
export async function GET(request: Request) {
  return manufacturingRead(request, async (client, context) => ({ queue: await getVarianceReviewQueue(client, context) }));
}
