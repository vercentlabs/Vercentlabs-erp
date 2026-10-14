import { resolveEffectiveBomRevision } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// The BOM revision production of a product would use on a date (?itemId=&productionDate=; default now).
export async function GET(request: Request) {
  const url = new URL(request.url);
  return manufacturingRead(request, async (client, context) => ({ resolved: await resolveEffectiveBomRevision(client, context, {
    itemId: url.searchParams.get("itemId"), productionDate: url.searchParams.get("productionDate") || undefined }) }));
}
