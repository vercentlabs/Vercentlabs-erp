import {
  cancelInspection, finalizeInspection, getQualityInspection, recordInspectionPrint, recoverInspection, reviewInspection, submitInspection, validateInspection,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { inspectionActionSchema } from "@/features/manufacturing/quality/api/qi-schemas";
import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// GET validate (what finalizing would do now; decides nothing) · document (the inspection report to print).
export async function GET(request: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  return manufacturingRead(request, async (client, context) => {
    switch (action) {
      case "validate": return { validation: await validateInspection(client, context, id) };
      case "document": return { inspection: await getQualityInspection(client, context, id) };
      default: throw new HttpError(404, "Unknown inspection view.", "NOT_FOUND");
    }
  });
}

// submit · review (decision APPROVE | RETURN) · finalize · cancel · print (counts a copy) · recover.
export async function POST(request: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  return manufacturingMutation(request, inspectionActionSchema, async (client, context, input) => {
    switch (action) {
      case "submit": return { inspection: await submitInspection(client, context, id, input) };
      case "review": return { inspection: await reviewInspection(client, context, id, input) };
      case "finalize": return await finalizeInspection(client, context, id, input);
      case "cancel": return { inspection: await cancelInspection(client, context, id, input) };
      case "print": return { inspection: await recordInspectionPrint(client, context, id) };
      case "recover": return await recoverInspection(client, context, id);
      default: throw new HttpError(404, "Unknown inspection action.", "NOT_FOUND");
    }
  });
}
