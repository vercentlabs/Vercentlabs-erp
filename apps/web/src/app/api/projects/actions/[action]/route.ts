import { z } from "zod";

import {
  addProjectComment,
  addProjectTaskDependency,
  approveProjectRecord,
  changeProjectStatus,
  changeTaskStatus,
  createProjectRecord,
  createProjectTaskRecord,
  deleteProjectComment,
  deleteProjectTask,
  deleteTimeEntryRecord,
  logProjectTime,
  recallTimesheet,
  removeProjectMember,
  removeProjectTaskDependency,
  reopenApprovedTime,
  reviewTimesheet,
  saveProjectMember,
  saveProjectMilestone,
  saveProjectSettings,
  saveStatusReport,
  setMilestoneStatus,
  setTaskProgress,
  submitTimesheet,
  updateProjectRecord,
  updateProjectTaskRecord,
  updateTimeEntryRecord,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { projectsMutation } from "@/features/projects/shared/route-helpers";

const body = z.record(z.string(), z.unknown());
const str = (input: Record<string, unknown>, key: string) =>
  String(input[key] ?? "");
const idOf = (input: Record<string, unknown>) => {
  const id = str(input, "id");
  if (!id) throw new HttpError(400, "A record id is required.");
  return id;
};

// One mutation endpoint per Projects operation. Each domain function enforces its OWN permission, state machine,
// project scope and segregation of duties (a submitter never approves their own time, expense, budget or billing).
export async function POST(
  request: Request,
  ctx: { params: Promise<{ action: string }> },
) {
  const { action } = await ctx.params;
  return projectsMutation(
    request,
    body,
    async (client, context, input) => {
      switch (action) {
        case "settings-save":
          return { record: await saveProjectSettings(client, context, input) };
        case "project-create":
          return { record: await createProjectRecord(client, context, input) };
        case "project-update":
          return {
            record: await updateProjectRecord(
              client,
              context,
              idOf(input),
              input,
            ),
          };
        case "project-approve":
          return {
            record: await approveProjectRecord(client, context, idOf(input)),
          };
        case "project-status":
          return {
            record: await changeProjectStatus(
              client,
              context,
              idOf(input),
              str(input, "transition"),
              input,
            ),
          };
        case "member-save":
          return {
            record: await saveProjectMember(
              client,
              context,
              str(input, "projectId"),
              input,
            ),
          };
        case "member-remove":
          return {
            record: await removeProjectMember(
              client,
              context,
              str(input, "projectId"),
              str(input, "userId"),
            ),
          };
        case "task-create":
          return {
            record: await createProjectTaskRecord(
              client,
              context,
              str(input, "projectId"),
              input,
            ),
          };
        case "task-update":
          return {
            record: await updateProjectTaskRecord(
              client,
              context,
              idOf(input),
              input,
            ),
          };
        case "task-status":
          return {
            record: await changeTaskStatus(client, context, idOf(input), input),
          };
        case "task-progress":
          return {
            record: await setTaskProgress(
              client,
              context,
              idOf(input),
              input.percent,
            ),
          };
        case "task-delete":
          return {
            record: await deleteProjectTask(client, context, idOf(input)),
          };
        case "dependency-add":
          return {
            record: await addProjectTaskDependency(client, context, input),
          };
        case "dependency-remove":
          return {
            record: await removeProjectTaskDependency(
              client,
              context,
              str(input, "predecessorTaskId"),
              str(input, "successorTaskId"),
            ),
          };
        case "milestone-save":
          return {
            record: await saveProjectMilestone(
              client,
              context,
              str(input, "projectId"),
              input,
            ),
          };
        case "milestone-status":
          return {
            record: await setMilestoneStatus(
              client,
              context,
              idOf(input),
              str(input, "transition"),
              input,
            ),
          };
        case "status-report":
          return {
            record: await saveStatusReport(
              client,
              context,
              str(input, "projectId"),
              input,
            ),
          };
        case "time-log":
          return { record: await logProjectTime(client, context, input) };
        case "time-update":
          return {
            record: await updateTimeEntryRecord(
              client,
              context,
              idOf(input),
              input,
            ),
          };
        case "time-delete":
          return {
            record: await deleteTimeEntryRecord(client, context, idOf(input)),
          };
        case "time-reopen":
          return {
            record: await reopenApprovedTime(
              client,
              context,
              idOf(input),
              str(input, "reason"),
            ),
          };
        case "timesheet-submit":
          return { record: await submitTimesheet(client, context, input) };
        case "timesheet-recall":
          return { record: await recallTimesheet(client, context, input) };
        case "timesheet-approve":
          return {
            record: await reviewTimesheet(client, context, idOf(input), true),
          };
        case "timesheet-reject":
          return {
            record: await reviewTimesheet(
              client,
              context,
              idOf(input),
              false,
              str(input, "reason"),
            ),
          };
        case "comment-add":
          return { record: await addProjectComment(client, context, input) };
        case "comment-delete":
          return {
            record: await deleteProjectComment(client, context, idOf(input)),
          };
        default:
          throw new HttpError(404, "Unknown Projects action.");
      }
    },
    200,
    "projects.view",
  );
}
