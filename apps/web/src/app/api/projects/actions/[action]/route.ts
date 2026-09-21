import { z } from "zod";

import {
  addProjectComment, addProjectDocument, addProjectTaskDependency, approveBillingLine, approveProjectBaseline, approveProjectBudget, approveProjectRecord, cancelBillingLine, captureProfitabilitySnapshot,
  changeProjectStatus, changeTaskStatus, createFixedPriceBilling, createMilestoneBilling, createProjectBaseline, createProjectBudget, createProjectExpense, createProjectIssue, createProjectRecord,
  createProjectRisk, createProjectTaskRecord, createTimeMaterialBilling, deleteProjectComment, deleteProjectExpense, deleteProjectTask, deleteTimeEntryRecord, invoiceBillingLine, issueProjectMaterial,
  linkProcurementDocument, logProjectTime, realizeProjectRisk, recallTimesheet, reimburseProjectExpense, rejectProjectBaseline, rejectProjectBudget, removeProjectDocument, removeProjectMember,
  removeProjectTaskDependency, reopenApprovedTime, returnProjectMaterial, reviewProjectExpense, reviewTimesheet, saveProjectMember, saveProjectMilestone, saveProjectSettings, saveProjectTemplate,
  saveStatusReport, scheduleProject, setMilestoneStatus, setTaskProgress, submitProjectBudget, submitProjectExpense, submitTimesheet, unlinkProcurementDocument, updateProjectExpense, updateProjectIssue,
  updateProjectRecord, updateProjectRisk, updateProjectTaskRecord, updateTimeEntryRecord,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { projectsMutation } from "@/features/projects/shared/route-helpers";

const body = z.record(z.string(), z.unknown());
const str = (input: Record<string, unknown>, key: string) => String(input[key] ?? "");
const idOf = (input: Record<string, unknown>) => {
  const id = str(input, "id");
  if (!id) throw new HttpError(400, "A record id is required.");
  return id;
};

// A template is typed as one item per line: "Name; days; hours". A line starting with "- " is a sub-task of the
// previous top-level task, and "M: Name; offset days; billing %" is a milestone. Predecessors: "> 2,3" at the end.
function parseTemplateItems(text: string) {
  const items: Array<Record<string, unknown>> = [];
  let lastTop = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const sequence = items.length + 1;
    let rest = line;
    let itemType = "task";
    let parentSequence: number | undefined;
    if (/^m:/i.test(rest)) { itemType = "milestone"; rest = rest.slice(2).trim(); }
    else if (rest.startsWith("-")) { parentSequence = lastTop || undefined; rest = rest.slice(1).trim(); }
    let predecessorSequences: number[] = [];
    const pred = rest.match(/>\s*([\d,\s]+)$/);
    if (pred) { predecessorSequences = pred[1].split(",").map((n) => Number(n.trim())).filter((n) => n > 0); rest = rest.replace(/>\s*[\d,\s]+$/, "").trim(); }
    const [name, a, b] = rest.split(";").map((part) => part.trim());
    if (itemType === "milestone") items.push({ sequence, itemType, name, offsetDays: Number(a || 0), billingPercent: Number(b || 0) });
    else {
      items.push({ sequence, itemType, name, durationDays: Number(a || 1), estimatedHours: Number(b || 0), parentSequence, predecessorSequences });
      if (!parentSequence) lastTop = sequence;
    }
  }
  return items;
}

// One mutation endpoint per Projects operation. Each domain function enforces its OWN permission, state machine,
// project scope and segregation of duties (a submitter never approves their own time, expense, budget or billing).
export async function POST(request: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  return projectsMutation(
    request,
    body,
    async (client, context, input) => {
      switch (action) {
        case "settings-save":
          return { record: await saveProjectSettings(client, context, input) };
        case "template-save":
          return { record: await saveProjectTemplate(client, context, typeof input.itemsText === "string" ? { ...input, items: parseTemplateItems(input.itemsText) } : input) };
        case "project-create":
          return { record: await createProjectRecord(client, context, input) };
        case "project-update":
          return { record: await updateProjectRecord(client, context, idOf(input), input) };
        case "project-approve":
          return { record: await approveProjectRecord(client, context, idOf(input)) };
        case "project-status":
          return { record: await changeProjectStatus(client, context, idOf(input), str(input, "transition"), input) };
        case "member-save":
          return { record: await saveProjectMember(client, context, str(input, "projectId"), input) };
        case "member-remove":
          return { record: await removeProjectMember(client, context, str(input, "projectId"), str(input, "userId")) };
        case "task-create":
          return { record: await createProjectTaskRecord(client, context, str(input, "projectId"), input) };
        case "task-update":
          return { record: await updateProjectTaskRecord(client, context, idOf(input), input) };
        case "task-status":
          return { record: await changeTaskStatus(client, context, idOf(input), input) };
        case "task-progress":
          return { record: await setTaskProgress(client, context, idOf(input), input.percent) };
        case "task-delete":
          return { record: await deleteProjectTask(client, context, idOf(input)) };
        case "dependency-add":
          return { record: await addProjectTaskDependency(client, context, input) };
        case "dependency-remove":
          return { record: await removeProjectTaskDependency(client, context, str(input, "predecessorTaskId"), str(input, "successorTaskId")) };
        case "milestone-save":
          return { record: await saveProjectMilestone(client, context, str(input, "projectId"), input) };
        case "milestone-status":
          return { record: await setMilestoneStatus(client, context, idOf(input), str(input, "transition"), input) };
        case "schedule-apply":
          return { record: await scheduleProject(client, context, str(input, "projectId"), { ...input, apply: true }) };
        case "status-report":
          return { record: await saveStatusReport(client, context, str(input, "projectId"), input) };
        case "baseline-create":
          return { record: await createProjectBaseline(client, context, str(input, "projectId"), input) };
        case "baseline-approve":
          return { record: await approveProjectBaseline(client, context, idOf(input)) };
        case "baseline-reject":
          return { record: await rejectProjectBaseline(client, context, idOf(input), str(input, "reason")) };
        case "time-log":
          return { record: await logProjectTime(client, context, input) };
        case "time-update":
          return { record: await updateTimeEntryRecord(client, context, idOf(input), input) };
        case "time-delete":
          return { record: await deleteTimeEntryRecord(client, context, idOf(input)) };
        case "time-reopen":
          return { record: await reopenApprovedTime(client, context, idOf(input), str(input, "reason")) };
        case "timesheet-submit":
          return { record: await submitTimesheet(client, context, input) };
        case "timesheet-recall":
          return { record: await recallTimesheet(client, context, input) };
        case "timesheet-approve":
          return { record: await reviewTimesheet(client, context, idOf(input), true) };
        case "timesheet-reject":
          return { record: await reviewTimesheet(client, context, idOf(input), false, str(input, "reason")) };
        case "expense-create":
          return { record: await createProjectExpense(client, context, input) };
        case "expense-update":
          return { record: await updateProjectExpense(client, context, idOf(input), input) };
        case "expense-submit":
          return { record: await submitProjectExpense(client, context, idOf(input)) };
        case "expense-approve":
          return { record: await reviewProjectExpense(client, context, idOf(input), true) };
        case "expense-reject":
          return { record: await reviewProjectExpense(client, context, idOf(input), false, str(input, "reason")) };
        case "expense-reimburse":
          return { record: await reimburseProjectExpense(client, context, idOf(input)) };
        case "expense-delete":
          return { record: await deleteProjectExpense(client, context, idOf(input)) };
        case "material-issue":
          return { record: await issueProjectMaterial(client, context, str(input, "projectId"), input) };
        case "material-return":
          return { record: await returnProjectMaterial(client, context, idOf(input), input) };
        case "procurement-link":
          return { record: await linkProcurementDocument(client, context, str(input, "projectId"), input) };
        case "procurement-unlink":
          return { record: await unlinkProcurementDocument(client, context, idOf(input)) };
        case "budget-create":
          return { record: await createProjectBudget(client, context, str(input, "projectId"), input) };
        case "budget-submit":
          return { record: await submitProjectBudget(client, context, idOf(input)) };
        case "budget-approve":
          return { record: await approveProjectBudget(client, context, idOf(input)) };
        case "budget-reject":
          return { record: await rejectProjectBudget(client, context, idOf(input), str(input, "reason")) };
        case "profitability-snapshot":
          return { record: await captureProfitabilitySnapshot(client, context, str(input, "projectId")) };
        case "billing-create": {
          const kind = str(input, "billingKind");
          if (kind === "milestone") return { record: await createMilestoneBilling(client, context, str(input, "milestoneId"), input) };
          if (kind === "time_material") return { record: await createTimeMaterialBilling(client, context, str(input, "projectId"), input) };
          return { record: await createFixedPriceBilling(client, context, str(input, "projectId"), input) };
        }
        case "billing-approve":
          return { record: await approveBillingLine(client, context, idOf(input)) };
        case "billing-invoice":
          return { record: await invoiceBillingLine(client, context, idOf(input)) };
        case "billing-cancel":
          return { record: await cancelBillingLine(client, context, idOf(input), str(input, "reason")) };
        case "issue-create":
          return { record: await createProjectIssue(client, context, str(input, "projectId"), input) };
        case "issue-update":
          return { record: await updateProjectIssue(client, context, idOf(input), input) };
        case "risk-create":
          return { record: await createProjectRisk(client, context, str(input, "projectId"), input) };
        case "risk-update":
          return { record: await updateProjectRisk(client, context, idOf(input), input) };
        case "risk-realize":
          return { record: await realizeProjectRisk(client, context, idOf(input), input) };
        case "document-add":
          return { record: await addProjectDocument(client, context, str(input, "projectId"), input) };
        case "document-remove":
          return { record: await removeProjectDocument(client, context, idOf(input)) };
        case "comment-add":
          return { record: await addProjectComment(client, context, input) };
        case "comment-delete":
          return { record: await deleteProjectComment(client, context, idOf(input)) };
        default:
          throw new HttpError(404, "Unknown Projects action.");
      }
    },
    200,
    "projects.view",
  );
}
