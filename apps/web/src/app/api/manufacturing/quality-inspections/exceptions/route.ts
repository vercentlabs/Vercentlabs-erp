import { getQualityExceptions } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// The quality exceptions queue: reviews waiting, inspections open too long, active holds, inspections needing recovery.
export async function GET(request: Request) {
  return manufacturingRead(request, async (client, context) => ({ exceptions: await getQualityExceptions(client, context) }));
}
