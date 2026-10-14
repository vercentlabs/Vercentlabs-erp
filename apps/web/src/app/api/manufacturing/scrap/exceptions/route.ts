import { getScrapExceptions } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// The scrap exceptions queue: approvals waiting, approved and not posted, corrections waiting, postings needing recovery, rejected output not disposed of.
export async function GET(request: Request) {
  return manufacturingRead(request, async (client, context) => ({ exceptions: await getScrapExceptions(client, context) }));
}
