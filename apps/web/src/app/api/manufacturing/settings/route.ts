import { z } from "zod";

import { getManufacturingSettings, updateManufacturingSettings } from "@vercentlabs/api";

import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// Manufacturing policy: approvals, overproduction tolerance, inspection, BOM cost staleness.
export async function GET(request: Request) {
  return manufacturingRead(request, async (client, context) => ({ settings: await getManufacturingSettings(client, context) }));
}

const schema = z.object({
  bomSelfApprovalAllowed: z.boolean().optional(), bomCostStaleAfterDays: z.number().int().optional(), moSelfApprovalAllowed: z.boolean().optional(),
  moVarianceSelfApprovalAllowed: z.boolean().optional(), moOverproductionTolerancePct: z.union([z.string(), z.number()]).optional(), moRequireInspection: z.boolean().optional(),
});

export async function PUT(request: Request) {
  return manufacturingMutation(request, schema, async (client, context, input) => ({ settings: await updateManufacturingSettings(client, context, input) }));
}
