import { listBomReviewRequests } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// Requests to engineering to review a BOM standard (?status=all for closed ones too).
export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status") || undefined;
  return manufacturingRead(request, async (client, context) => ({ requests: await listBomReviewRequests(client, context, { status }) }));
}
