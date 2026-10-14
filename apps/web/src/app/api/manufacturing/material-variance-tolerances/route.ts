import { listVarianceGroups, listVarianceTolerances, setVarianceTolerance } from "@vercentlabs/api";

import { toleranceSchema } from "@/features/manufacturing/variance/api/variance-schemas";
import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// The tolerance overrides in force (per item and item group) and the groups one may name.
export async function GET(request: Request) {
  return manufacturingRead(request, async (client, context) => ({ tolerances: await listVarianceTolerances(client, context), groups: await listVarianceGroups(client, context) }));
}

// Set the override for an item or a group (it replaces the one in force; its version goes up).
export async function POST(request: Request) {
  return manufacturingMutation(request, toleranceSchema, async (client, context, input) => setVarianceTolerance(client, context, input), 201);
}
