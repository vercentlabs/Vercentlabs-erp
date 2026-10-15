import {
  acknowledgeMilestoneBilling, addMilestoneCriterion, addMilestoneDependency, addMilestoneNote, assignMilestoneOwner, cancelProjectMilestone, completeMilestoneCriterion,
  completeProjectMilestone, getMilestoneActivity, getMilestoneNotes, linkMilestoneTask, raiseMilestoneBlocker, recordCustomerAcceptanceEvidence, recordMilestoneApproval,
  removeMilestoneCriterion, removeMilestoneDependency, reopenMilestoneCriterion, reopenProjectMilestone, reorderMilestoneCriteria, requestMilestoneBilling, resolveMilestoneBlocker,
  searchMilestoneTasks, setMilestoneBillingStage, startProjectMilestone, submitProjectMilestone, updateMilestoneCriterion, updateMilestoneTaskLink,
  waiveMilestoneCriterion, waiveMilestoneForProjectCompletion, withdrawMilestoneBilling, withdrawMilestoneSubmission,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

type Params = { params: Promise<{ milestoneId: string; action: string }> };
// GET activity · notes · task-search?search=
export async function GET(request: Request, ctx: Params) {
  const { milestoneId, action } = await ctx.params;
  return projectsRead(request, async (client, context, url) => {
    switch (action) {
      case "activity": return { activity: await getMilestoneActivity(client, context, milestoneId) };
      case "notes": return { notes: await getMilestoneNotes(client, context, milestoneId) };
      case "task-search": return { tasks: await searchMilestoneTasks(client, context, milestoneId, url.searchParams.get("search") ?? "") };
      default: throw new HttpError(404, "Unknown milestone view.", "NOT_FOUND");
    }
  }, "projects.milestones.view");
}
// The commands; each checks its own permission, the person's place on the project and the milestone's state. The domain validates every field.
type Input = Record<string, unknown>;
type Command = (client: Parameters<typeof startProjectMilestone>[0], context: Parameters<typeof startProjectMilestone>[1], id: string, input: Input) => Promise<unknown>;
const COMMANDS: Record<string, Command> = {
  assign: assignMilestoneOwner, start: startProjectMilestone, "raise-blocker": raiseMilestoneBlocker, "resolve-blocker": resolveMilestoneBlocker,
  "add-criterion": addMilestoneCriterion, "update-criterion": updateMilestoneCriterion, "remove-criterion": removeMilestoneCriterion, "reorder-criteria": reorderMilestoneCriteria,
  "complete-criterion": completeMilestoneCriterion, "reopen-criterion": reopenMilestoneCriterion, "waive-criterion": waiveMilestoneCriterion,
  "link-task": linkMilestoneTask, "update-task-link": updateMilestoneTaskLink, "add-dependency": addMilestoneDependency, "remove-dependency": removeMilestoneDependency,
  submit: submitProjectMilestone, withdraw: withdrawMilestoneSubmission, approve: recordMilestoneApproval, "customer-acceptance": recordCustomerAcceptanceEvidence,
  complete: completeProjectMilestone, reopen: reopenProjectMilestone, cancel: cancelProjectMilestone, "waive-for-completion": waiveMilestoneForProjectCompletion,
  "billing-stage": setMilestoneBillingStage, "request-billing": requestMilestoneBilling, "withdraw-billing": withdrawMilestoneBilling, "acknowledge-billing": acknowledgeMilestoneBilling,
  note: addMilestoneNote,
};
export async function POST(request: Request, ctx: Params) {
  const { milestoneId, action } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    const command = COMMANDS[action];
    if (!command) throw new HttpError(404, "Unknown milestone action.", "NOT_FOUND");
    return command(client, context, milestoneId, input);
  }, 200, "projects.milestones.view");
}
