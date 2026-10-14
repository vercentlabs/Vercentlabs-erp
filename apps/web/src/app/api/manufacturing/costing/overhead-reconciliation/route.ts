import { getOverheadReconciliation, reconcileOverheadPeriod } from "@vercentlabs/api";
import { z } from "zod";

import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// A month's overhead, per category: the actual pool against what was applied to orders (?period=YYYY-MM).
export async function GET(request: Request) {
  const period = new URL(request.url).searchParams.get("period") ?? "";
  return manufacturingRead(request, async (client, context) => ({ reconciliation: await getOverheadReconciliation(client, context, period) }));
}

const schema = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/), categoryId: z.string().uuid(), note: z.string().min(1).max(1000), financeReference: z.string().max(200).optional() });
// Record Finance's review of a category's difference for the month.
export async function POST(request: Request) {
  return manufacturingMutation(request, schema, async (client, context, input) => reconcileOverheadPeriod(client, context, input), 201);
}
