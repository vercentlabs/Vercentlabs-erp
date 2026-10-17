import { getAssetsControlCenter } from "@vercentlabs/api";

import { assetsRead } from "@/features/assets/shared/route-helpers";

// GET every Assets exception and reconciliation queue the person may see, each linked to its owning workflow.
export async function GET(request: Request) {
  return assetsRead(request, (client, context) => getAssetsControlCenter(client, context));
}
