import {
  addTaskComment, archiveProjectTask, assignProjectTask, blockProjectTask, cancelProjectTask, completeProjectTask, decideTaskReview, getTaskActivity, getTaskComments,
  manageTaskChecklist, manageTaskDependency, recordTaskEvidence, removeTaskComment, reopenProjectTask, resolveTaskBlocker, startProjectTask, submitTaskForReview,
  transitionProjectTask, withdrawTaskReview,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

type Params = { params: Promise<{ taskId: string; action: string }> };
// GET activity · comments
export async function GET(request: Request, ctx: Params) {
  const { taskId, action } = await ctx.params;
  return projectsRead(request, async (client, context) => {
    switch (action) {
      case "activity": return { activity: await getTaskActivity(client, context, taskId) };
      case "comments": return { comments: await getTaskComments(client, context, taskId) };
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
  evidence: recordTaskEvidence, checklist: manageTaskChecklist, dependency: manageTaskDependency, comment: addTaskComment, "remove-comment": removeTaskComment,
};
export async function POST(request: Request, ctx: Params) {
  const { taskId, action } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    const command = COMMANDS[action];
    if (!command) throw new HttpError(404, "Unknown task action.", "NOT_FOUND");
    return command(client, context, taskId, input);
  }, 200, "projects.tasks.view");
}
