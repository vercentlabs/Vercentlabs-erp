import { listInProcessExceptions } from "@vercentlabs/api";

import { qualityRead } from "@/features/quality/shared/route-helpers";

// Finished output held by a configuration exception, recovery, rework not confirmed, scrap Manufacturing has not recorded.
export async function GET(request: Request) {
  return qualityRead(request, async (client, context) => ({ rows: await listInProcessExceptions(client, context, { type: "final" }) }), "quality.final.view");
}
