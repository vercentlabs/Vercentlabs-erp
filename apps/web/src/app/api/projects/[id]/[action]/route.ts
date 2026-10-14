import {
  activateProject, archiveProject, cancelProject, completeProject, decideProjectActivation, deleteDraftProject, flagProjectRisk, getProjectActivity, getProjectCancellationReview,
  getProjectCompletionCheck, getProjectStatusHistory, getProjectSummary, noteProjectHealth, placeProjectOnHold, reopenProject, restoreProject, resumeProject, searchLinkableRecords,
  startProject, validateProjectActivation,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

type Params = { params: Promise<{ id: string; action: string }> };
// GET summary · activity · status-history · completion-check · cancellation-review · activation-check · link-search?type=&search=
export async function GET(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  return projectsRead(request, async (client, context, url) => {
    switch (action) {
      case "summary": return { summary: await getProjectSummary(client, context, id) };
      case "activity": return { activity: await getProjectActivity(client, context, id) };
      case "status-history": return { history: await getProjectStatusHistory(client, context, id) };
      case "completion-check": return { check: await getProjectCompletionCheck(client, context, id) };
      case "cancellation-review": return { review: await getProjectCancellationReview(client, context, id) };
      case "activation-check": return { check: await validateProjectActivation(client, context, id) };
      case "link-search": return { records: await searchLinkableRecords(client, context, id, url.searchParams.get("type") ?? "", url.searchParams.get("search") ?? "") };
      default: throw new HttpError(404, "Unknown project view.", "NOT_FOUND");
    }
  });
}
const schema = z.object({
  expectedVersion: z.number().int().optional(), idempotencyKey: z.string().trim().min(1).max(200).optional(), decision: z.enum(["APPROVE", "REJECT"]).optional(),
  note: z.string().max(2000).optional(), reason: z.string().max(2000).optional(), resolution: z.string().max(2000).optional(), startDate: z.string().max(10).optional(),
  ownerUserId: z.string().uuid().optional(), expectedResolutionDate: z.string().max(10).optional(), completionDate: z.string().max(10).optional(),
  closingNote: z.string().max(4000).optional(), deliverablesConfirmed: z.boolean().optional(), customerAcceptance: z.string().max(2000).optional(),
  acknowledgeOutstanding: z.boolean().optional(), acknowledgeDependencies: z.boolean().optional(), flagged: z.boolean().optional(),
});
// POST activate · decide · start · hold · resume · complete · reopen · cancel · archive · restore · delete · risk · health-note
export async function POST(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  return projectsMutation(request, schema, async (client, context, input) => {
    switch (action) {
      case "activate": return activateProject(client, context, id, input);
      case "decide": return decideProjectActivation(client, context, id, input);
      case "start": return startProject(client, context, id, input);
      case "hold": return placeProjectOnHold(client, context, id, input);
      case "resume": return resumeProject(client, context, id, input);
      case "complete": return completeProject(client, context, id, input);
      case "reopen": return reopenProject(client, context, id, input);
      case "cancel": return cancelProject(client, context, id, input);
      case "archive": return archiveProject(client, context, id, input);
      case "restore": return restoreProject(client, context, id);
      case "delete": return deleteDraftProject(client, context, id);
      case "risk": return flagProjectRisk(client, context, id, input);
      case "health-note": return noteProjectHealth(client, context, id, input);
      default: throw new HttpError(404, "Unknown project action.", "NOT_FOUND");
    }
  });
}
