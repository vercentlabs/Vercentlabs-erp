import { getQualityInspection, recordInspectionResults } from "@vercentlabs/api";

import { inspectionRecordSchema } from "@/features/manufacturing/quality/api/qi-schemas";
import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// One inspection: the checklist with each result evaluated, defects, the decision, its review, what it posted and its history.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingRead(request, async (client, context) => ({ inspection: await getQualityInspection(client, context, id) }));
}

// Record results, defects and the decision on an open inspection (a submitted one returns to in progress).
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingMutation(request, inspectionRecordSchema, async (client, context, input) => ({ inspection: await recordInspectionResults(client, context, id, input) }));
}
