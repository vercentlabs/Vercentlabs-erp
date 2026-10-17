import {
  archiveProjectTask, assignProjectTask, blockProjectTask, cancelProjectTask, completeProjectTask, decideTaskReview, getTaskActivity, getTaskAssignmentHistory,
  manageTaskChecklist, manageTaskDependency, recordTaskEvidence, reopenProjectTask, resolveTaskBlocker, startProjectTask, submitTaskForReview,
  transitionProjectTask, updateTaskPriority, withdrawTaskReview,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

type Params = { params: Promise<{ taskId: string; action: string }> };
// GET activity · assignment-history (the discussion is /api/projects/comments)
export async function GET(request: Request, ctx: Params) {
  const { taskId, action } = await ctx.params;
  return projectsRead(request, async (client, context) => {
    switch (action) {
      case "activity": return { activity: await getTaskActivity(client, context, taskId) };
      case "assignment-history": return { history: await getTaskAssignmentHistory(client, context, taskId) };
      default: throw new HttpError(404, "Unknown task view.", "NOT_FOUND");
    }
  }, "projects.tasks.view");
}
// The commands; each checks its own permission, the person's place on the project and the task's state. The domain validates every field.
type Input = Record<string, unknown>;
type Command = (client: Parameters<typeof startProjectTask>[0], context: Parameters<typeof startProjectTask>[1], id: string, input: Input) => Promise<unknown>;
const COMMANDS: Record<string, Command> = {
  transition: transitionProjectTask, start: startProjectTask, complete: completeProjectTask, submit: submitTaskForReview, withdraw: withdrawTaskReview, decide: decideTaskReview,
  reopen: reopenProjectTask, cancel: cancelProjectTask, archive: archiveProjectTask, assign: assignProjectTask, block: blockProjectTask, "resolve-blocker": resolveTaskBlocker,
  evidence: recordTaskEvidence, priority: updateTaskPriority, checklist: manageTaskChecklist, dependency: manageTaskDependency,
};
export async function POST(request: Request, ctx: Params) {
  const { taskId, action } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    const command = COMMANDS[action];
    if (!command) throw new HttpError(404, "Unknown task action.", "NOT_FOUND");
    return command(client, context, taskId, input);
  }, 200, "projects.tasks.view");
}
