import {
  addApplicabilityRule, addInspectionCharacteristics, approveSpecificationVersion, copyInspectionSpecification, createSpecificationRevision, deactivateApplicabilityRule,
  publishSpecificationVersion, rejectSpecificationVersion, removeInspectionCharacteristic, reorderInspectionCharacteristics, requestSpecificationChanges, retireInspectionSpecification,
  submitSpecificationForReview, updateInspectionCharacteristic, updateInspectionSpecificationDraft, validateSpecificationVersion,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { qualityMutation } from "@/features/quality/shared/route-helpers";

// POST copy · revise · retire · add-rule · deactivate-rule, and for one version (body.versionId): edit · add-checks · update-check · remove-check · reorder ·
// validate · submit · request-changes · reject · approve · publish. Each domain function enforces its own permission, state and segregation of duties.
type Params = { params: Promise<{ specId: string; action: string }> };
export async function POST(request: Request, ctx: Params) {
  const { specId, action } = await ctx.params;
  return qualityMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    const versionId = String(input.versionId ?? "");
    switch (action) {
      case "copy": return copyInspectionSpecification(client, context, specId, input);
      case "revise": return createSpecificationRevision(client, context, specId, input);
      case "retire": return retireInspectionSpecification(client, context, specId, input);
      case "add-rule": return addApplicabilityRule(client, context, specId, input);
      case "deactivate-rule": return deactivateApplicabilityRule(client, context, specId, String(input.ruleId ?? ""), input);
      case "edit": return updateInspectionSpecificationDraft(client, context, specId, versionId, input);
      case "add-checks": return addInspectionCharacteristics(client, context, specId, versionId, input);
      case "update-check": return updateInspectionCharacteristic(client, context, specId, versionId, String(input.characteristicId ?? ""), input);
      case "remove-check": return removeInspectionCharacteristic(client, context, specId, versionId, String(input.characteristicId ?? ""));
      case "reorder": return reorderInspectionCharacteristics(client, context, specId, versionId, input);
      case "validate": return validateSpecificationVersion(client, context, specId, versionId);
      case "submit": return submitSpecificationForReview(client, context, specId, versionId, input);
      case "request-changes": return requestSpecificationChanges(client, context, specId, versionId, input);
      case "reject": return rejectSpecificationVersion(client, context, specId, versionId, input);
      case "approve": return approveSpecificationVersion(client, context, specId, versionId, input);
      case "publish": return publishSpecificationVersion(client, context, specId, versionId, input);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
