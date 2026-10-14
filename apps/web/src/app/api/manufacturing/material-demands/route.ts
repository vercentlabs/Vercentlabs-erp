import { listMaterialDemands } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// Material shortages handed to Procurement (Manufacturing and Procurement both read them; the domain checks who may).
export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status") ?? undefined;
  return manufacturingRead(request, async (client, context) => ({ demands: await listMaterialDemands(client, context, { status }) }), "workspace.view");
}
