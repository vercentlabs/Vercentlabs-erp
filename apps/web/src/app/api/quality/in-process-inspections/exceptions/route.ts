import { listInProcessExceptions } from "@vercentlabs/api";

import { qualityRead } from "@/features/quality/shared/route-helpers";

// Production output held by a configuration exception, recovery, rework not confirmed, scrap Manufacturing has not recorded.
export async function GET(request: Request) {
  return qualityRead(request, async (client, context) => ({ rows: await listInProcessExceptions(client, context) }), "quality.inprocess.view");
}
