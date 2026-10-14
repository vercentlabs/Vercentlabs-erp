import { listProductionActivity } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// Production activity across orders (?kind=all|materials|production|quality|receipts).
export async function GET(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind") || "all";
  return manufacturingRead(request, async (client, context) => ({ activity: await listProductionActivity(client, context, { kind }) }));
}
