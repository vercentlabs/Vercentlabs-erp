import { z } from "zod";

import { getManufacturingSettings, updateManufacturingSettings } from "@vercentlabs/api";

import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// Manufacturing policy: approvals, overproduction tolerance, inspection and its quality policies, materials, BOM cost staleness.
export async function GET(request: Request) {
  return manufacturingRead(request, async (client, context) => ({ settings: await getManufacturingSettings(client, context) }));
}

const schema = z.object({
  bomSelfApprovalAllowed: z.boolean().optional(), bomCostStaleAfterDays: z.number().int().optional(), moSelfApprovalAllowed: z.boolean().optional(),
  moVarianceSelfApprovalAllowed: z.boolean().optional(), moOverproductionTolerancePct: z.union([z.string(), z.number()]).optional(), moRequireInspection: z.boolean().optional(),
  moPartialReservationAllowed: z.boolean().optional(), moReleaseWithShortagesAllowed: z.boolean().optional(), miUnreservedIssueAllowed: z.boolean().optional(),
  miExcessTolerancePct: z.union([z.string(), z.number()]).optional(), mcVarianceWarningPct: z.union([z.string(), z.number()]).optional(), mcVarianceApprovalPct: z.union([z.string(), z.number()]).optional(),
  mcSelfApprovalAllowed: z.boolean().optional(), moProductionMaterialCheck: z.enum(["WARN", "BLOCK"]).optional(),
  qiTemplateRequired: z.boolean().optional(), qiReviewRequired: z.boolean().optional(), qiDeviationAllowed: z.boolean().optional(), qiSampleDecidesBatch: z.boolean().optional(),
  phResumeApprovalRequired: z.boolean().optional(), phOverdueAfterHours: z.number().int().optional(),
  mvSavingReviewPct: z.union([z.string(), z.number()]).optional(), mvApprovalValueAbove: z.union([z.string(), z.number(), z.null()]).optional(), mvBlockCompletion: z.boolean().optional(),
});

export async function PUT(request: Request) {
  return manufacturingMutation(request, schema, async (client, context, input) => ({ settings: await updateManufacturingSettings(client, context, input) }));
}
