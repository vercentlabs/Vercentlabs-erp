import { getCostingExceptions } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// Orders whose costing needs someone: Finance disagreeing, postings to recover, missing valuation or rates, costs due, adjustments waiting.
export async function GET(request: Request) {
  return manufacturingRead(request, async (client, context) => ({ exceptions: await getCostingExceptions(client, context) }));
}
