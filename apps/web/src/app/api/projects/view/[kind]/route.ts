import {
  getCloseBlockers, getCostBreakdown, getCostVariance, getGanttData, getKanbanBoard, getProjectCalendar, getProjectDesk, getProjectProfitabilityDesk, getProjectProgress, getProjectReport,
  getProjectSettings, getProjectTask, getProjectTemplate, getProjectWbs, getProjectsDeskDashboard, getResourceAvailability, getScheduleConflicts, getScheduleVariance, listBillingLines,
  listMyMentions, listProcurementLinks, listProjectBaselines, listProjectBudgets, listProjectComments, listProjectDocuments, listProjectExpenses, listProjectIssues, listProjectMaterials,
  listProjectMilestones, listProjectOptions, listProjectRisks, listProjectTasks, listProjectTeams, listProjectTemplates, listProjectTimeEntries, listProjectsDesk, listTimesheets, scheduleProject,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { projectsRead } from "@/features/projects/shared/route-helpers";

// One read endpoint per Projects screen, gated by projects.view (module-wide). Every domain function re-checks its
// OWN permission, scopes a team member to the projects they belong to, and masks money and rates.
export async function GET(request: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  return projectsRead(async (client, context) => {
    switch (kind) {
      case "options":
        return { options: await listProjectOptions(client, context) };
      case "settings":
        return { settings: await getProjectSettings(client, context) };
      case "dashboard":
        return { dashboard: await getProjectsDeskDashboard(client, context) };
      case "projects":
        return { rows: await listProjectsDesk(client, context, { status: get("status"), projectType: get("projectType"), health: get("health"), search: get("search") }) };
      case "project":
        return { project: await getProjectDesk(client, context, get("id") ?? "") };
      case "close-blockers":
        return { blockers: await getCloseBlockers(client, context, get("id") ?? "") };
      case "templates":
        return { rows: await listProjectTemplates(client, context) };
      case "template":
        return { template: await getProjectTemplate(client, context, get("id") ?? "") };
      case "teams":
        return { rows: await listProjectTeams(client, context, { projectId: get("projectId") }) };
      case "availability":
        return { availability: await getResourceAvailability(client, context, { from: get("from"), to: get("to") }) };
      case "tasks":
        return { rows: await listProjectTasks(client, context, { projectId: get("projectId"), status: get("status"), mine: get("mine"), overdue: get("overdue"), search: get("search") }) };
      case "task":
        return { task: await getProjectTask(client, context, get("id") ?? "") };
      case "wbs":
        return { wbs: await getProjectWbs(client, context, get("projectId") ?? "") };
      case "milestones":
        return { rows: await listProjectMilestones(client, context, { projectId: get("projectId"), status: get("status") }) };
      case "schedule":
        return { schedule: await scheduleProject(client, context, get("projectId") ?? "", {}) };
      case "conflicts":
        return { conflicts: await getScheduleConflicts(client, context, get("projectId") ?? "") };
      case "gantt":
        return { gantt: await getGanttData(client, context, get("projectId") ?? "") };
      case "kanban":
        return { board: await getKanbanBoard(client, context, get("projectId") ?? "", { mine: get("mine") }) };
      case "calendar":
        return { calendar: await getProjectCalendar(client, context, { projectId: get("projectId"), from: get("from"), to: get("to") }) };
      case "progress":
        return { progress: await getProjectProgress(client, context, get("projectId") ?? "") };
      case "baselines":
        return { rows: await listProjectBaselines(client, context, get("projectId") ?? "") };
      case "schedule-variance":
        return { variance: await getScheduleVariance(client, context, get("projectId") ?? "") };
      case "time-entries":
        return { rows: await listProjectTimeEntries(client, context, { projectId: get("projectId"), status: get("status"), from: get("from"), to: get("to"), mine: get("mine") }) };
      case "timesheets":
        return { rows: await listTimesheets(client, context, { status: get("status") }) };
      case "expenses":
        return { rows: await listProjectExpenses(client, context, { projectId: get("projectId"), status: get("status"), mine: get("mine") }) };
      case "materials":
        return { rows: await listProjectMaterials(client, context, { projectId: get("projectId") }) };
      case "procurement-links":
        return { rows: await listProcurementLinks(client, context, { projectId: get("projectId") }) };
      case "budgets":
        return { rows: await listProjectBudgets(client, context, { projectId: get("projectId") }) };
      case "cost-variance":
        return { variance: await getCostVariance(client, context, get("projectId") ?? "") };
      case "cost-breakdown":
        return { breakdown: await getCostBreakdown(client, context, get("projectId") ?? "") };
      case "profitability":
        return { profitability: await getProjectProfitabilityDesk(client, context, get("projectId") ?? "") };
      case "billing":
        return { rows: await listBillingLines(client, context, { projectId: get("projectId"), status: get("status") }) };
      case "issues":
        return { rows: await listProjectIssues(client, context, { projectId: get("projectId"), status: get("status"), severity: get("severity"), mine: get("mine") }) };
      case "risks":
        return { rows: await listProjectRisks(client, context, { projectId: get("projectId"), status: get("status") }) };
      case "documents":
        return { rows: await listProjectDocuments(client, context, { projectId: get("projectId"), type: get("type") }) };
      case "comments":
        return { rows: await listProjectComments(client, context, { entityType: get("entityType"), entityId: get("entityId") }) };
      case "mentions":
        return { rows: await listMyMentions(client, context) };
      case "report":
        return { report: await getProjectReport(client, context, get("key") ?? "", { from: get("from"), to: get("to"), status: get("status") }) };
      default:
        throw new HttpError(404, "Unknown Projects view.");
    }
  }, "projects.view");
}
