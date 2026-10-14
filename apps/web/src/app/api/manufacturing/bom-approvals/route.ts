import { listPendingBomApprovals } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// BOM revisions waiting for approval, with whether the person may approve each.
export async function GET(request: Request) {
  return manufacturingRead(request, async (client, context) => ({ approvals: await listPendingBomApprovals(client, context) }));
}
