import {
  activateQualityControlPointVersion, approveQualityControlPointVersion, copyQualityControlPoint, createQualityControlPointRevision, rejectQualityControlPointVersion,
  requestManualInspection, requestQualityControlPointChanges, retireQualityControlPoint, submitQualityControlPoint, updateQualityControlPointDraft, validateQualityControlPoint,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { qualityMutation } from "@/features/quality/shared/route-helpers";

// POST copy · revise · retire · manual-inspection, and for one version (body.versionId): edit · validate · submit · request-changes · reject · approve · publish.
type Params = { params: Promise<{ pointId: string; action: string }> };
export async function POST(request: Request, ctx: Params) {
  const { pointId, action } = await ctx.params;
  return qualityMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    const versionId = String(input.versionId ?? "");
    switch (action) {
      case "copy": return copyQualityControlPoint(client, context, pointId, input);
      case "revise": return createQualityControlPointRevision(client, context, pointId, input);
      case "retire": return retireQualityControlPoint(client, context, pointId, input);
      case "manual-inspection": return requestManualInspection(client, context, pointId, input);
      case "edit": return updateQualityControlPointDraft(client, context, pointId, versionId, input);
      case "validate": return validateQualityControlPoint(client, context, pointId, versionId);
      case "submit": return submitQualityControlPoint(client, context, pointId, versionId, input);
      case "request-changes": return requestQualityControlPointChanges(client, context, pointId, versionId, input);
      case "reject": return rejectQualityControlPointVersion(client, context, pointId, versionId, input);
      case "approve": return approveQualityControlPointVersion(client, context, pointId, versionId, input);
      case "publish": return activateQualityControlPointVersion(client, context, pointId, versionId, input);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
