import {
  cancelMaterialIssue, checkMaterialIssuePosting, decideMaterialIssueApproval, getMaterialIssue, postMaterialIssue, previewMaterialIssue, recordMaterialIssuePrint, recoverMaterialIssue,
  requestMaterialIssueApproval, reverseMaterialIssue, validateMaterialIssue,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { issueActionSchema } from "@/features/manufacturing/issues/api/mi-schemas";
import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// GET preview (what posting would do now; moves nothing) · posting-status (the note against Inventory and Finance) · document (the note to print).
export async function GET(request: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  return manufacturingRead(request, async (client, context) => {
    switch (action) {
      case "preview": return { preview: await previewMaterialIssue(client, context, id) };
      case "posting-status": return { posting: await checkMaterialIssuePosting(client, context, id) };
      case "document": return { issue: await getMaterialIssue(client, context, id) };
      default: throw new HttpError(404, "Unknown material issue view.", "NOT_FOUND");
    }
  });
}

// preview · validate · post · cancel · request-approval · decide-approval · request-reversal · print (counts a copy; posts nothing) · recover.
// Each checks its own permission in the domain; a retried post finds the posted note.
export async function POST(request: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  return manufacturingMutation(request, issueActionSchema, async (client, context, input) => {
    switch (action) {
      case "preview": return { preview: await previewMaterialIssue(client, context, id) };
      case "validate": return await validateMaterialIssue(client, context, id, input);
      case "post": return await postMaterialIssue(client, context, id, input);
      case "cancel": return { issue: await cancelMaterialIssue(client, context, id, input) };
      case "request-approval": return { issue: await requestMaterialIssueApproval(client, context, id, input) };
      case "decide-approval": return { issue: await decideMaterialIssueApproval(client, context, id, input) };
      case "request-reversal": return { issue: await reverseMaterialIssue(client, context, id, input) };
      case "print": return { issue: await recordMaterialIssuePrint(client, context, id) };
      case "recover": return await recoverMaterialIssue(client, context, id);
      default: throw new HttpError(404, "Unknown material issue action.", "NOT_FOUND");
    }
  });
}
