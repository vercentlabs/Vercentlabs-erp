import { createCostRateDraft, listCostRates, submitCostRate } from "@vercentlabs/api";
import { z } from "zod";

import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// Labor and overhead rates through their lifecycle (draft, waiting for approval, in force, retired) and whether each component is enabled.
export async function GET(request: Request) {
  return manufacturingRead(request, async (client, context) => ({ rates: await listCostRates(client, context) }));
}

const schema = z.object({
  component: z.enum(["LABOR", "OVERHEAD"]), basis: z.enum(["PER_GOOD_UNIT", "PER_BATCH", "PCT_OF_MATERIAL"]), rate: z.union([z.string(), z.number()]).transform((value) => String(value)),
  categoryId: z.string().uuid().nullable().optional(), finishedItemId: z.string().uuid().nullable().optional(), uomId: z.string().uuid().nullable().optional(),
  effectiveFrom: z.string().max(10).nullable().optional(), effectiveUntil: z.string().max(10).nullable().optional(), name: z.string().max(200).nullable().optional(),
  zeroReason: z.string().max(500).nullable().optional(), notes: z.string().max(500).nullable().optional(), submit: z.boolean().optional(),
});
// A new rate is a draft; with submit it goes straight to approval (someone else approves it).
export async function POST(request: Request) {
  return manufacturingMutation(request, schema, async (client, context, { submit, ...input }) => {
    const created = await createCostRateDraft(client, context, input);
    return submit ? { ...created, ...(await submitCostRate(client, context, created.rateId)) } : created;
  }, 201);
}
