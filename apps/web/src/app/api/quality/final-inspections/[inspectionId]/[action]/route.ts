import {
  amendIncomingResult, assignIncomingInspector, authorizeQualityDisposition, cancelIncomingInspection, confirmInProcessRework, evaluateIncomingInspection, recordIncomingResults,
  reviewIncomingInspection, startIncomingInspection, submitIncomingInspection,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { qualityMutation } from "@/features/quality/shared/route-helpers";

// POST assign · start (alias samples) · results (also PUT) · evaluate · submit · review · complete · dispose · reinspect · rework (a disposition
// sending a quantity to rework and reinspection) · confirm-rework (production confirms the rework) · amend · cancel. Each domain function
// enforces its own permission, state and separation of duties.
type Params = { params: Promise<{ inspectionId: string; action: string }> };
async function handle(request: Request, ctx: Params) {
  const { inspectionId, action } = await ctx.params;
  return qualityMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "assign": return assignIncomingInspector(client, context, inspectionId, input);
      case "start": case "samples": return startIncomingInspection(client, context, inspectionId, input);
      case "results": return recordIncomingResults(client, context, inspectionId, input);
      case "evaluate": return evaluateIncomingInspection(client, context, inspectionId);
      case "submit": return submitIncomingInspection(client, context, inspectionId, input);
      case "review": return reviewIncomingInspection(client, context, inspectionId, input);
      case "complete": return reviewIncomingInspection(client, context, inspectionId, { ...input, decision: "APPROVE" });
      case "dispose": return authorizeQualityDisposition(client, context, inspectionId, input);
      case "reinspect": return authorizeQualityDisposition(client, context, inspectionId, { ...input, decision: "REINSPECT" });
      case "rework": return authorizeQualityDisposition(client, context, inspectionId, { ...input, decision: "REWORK" });
      case "confirm-rework": return confirmInProcessRework(client, context, inspectionId, input);
      case "amend": return amendIncomingResult(client, context, inspectionId, input);
      case "cancel": return cancelIncomingInspection(client, context, inspectionId, input);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  }, 200, "quality.final.view");
}
export const POST = handle;
export const PUT = handle;
