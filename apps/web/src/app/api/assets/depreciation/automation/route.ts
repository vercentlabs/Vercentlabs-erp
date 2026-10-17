import { getDepreciationAutomation } from "@vercentlabs/api";

import { assetsRead } from "@/features/assets/shared/route-helpers";

// GET the automation overview: settings, readiness, health, recent executions and the coming months.
export async function GET(request: Request) {
  return assetsRead(request, (client, context) => getDepreciationAutomation(client, context));
}
