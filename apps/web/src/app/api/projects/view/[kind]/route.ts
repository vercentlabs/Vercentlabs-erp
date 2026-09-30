import {
  getCloseBlockers,
  getGanttData,
  getKanbanBoard,
  getProjectCalendar,
  getProjectDesk,
  getProjectProgress,
  getProjectSettings,
  getProjectTask,
  getProjectWbs,
  getProjectsDeskDashboard,
  listMyMentions,
  listProjectComments,
  listProjectMilestones,
  listProjectOptions,
  listProjectTasks,
  listProjectTeams,
  listProjectTimeEntries,
  listProjectsDesk,
  listTimesheets,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { projectsRead } from "@/features/projects/shared/route-helpers";

// One read endpoint per Projects screen, gated by projects.view (module-wide). Every domain function re-checks its
// OWN permission, scopes a team member to the projects they belong to, and masks money and rates.
export async function GET(
  request: Request,
  ctx: { params: Promise<{ kind: string }> },
) {
  const { kind } = await ctx.params;
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  return projectsRead(
    request,
    async (client, context) => {
      switch (kind) {
        case "options":
          return { options: await listProjectOptions(client, context) };
        case "settings":
          return { settings: await getProjectSettings(client, context) };
        case "dashboard":
          return { dashboard: await getProjectsDeskDashboard(client, context) };
        case "projects":
          return {
            rows: await listProjectsDesk(client, context, {
              status: get("status"),
              projectType: get("projectType"),
              health: get("health"),
              search: get("search"),
            }),
          };
        case "project":
          return {
            project: await getProjectDesk(client, context, get("id") ?? ""),
          };
        case "close-blockers":
          return {
            blockers: await getCloseBlockers(client, context, get("id") ?? ""),
          };
        case "teams":
          return {
            rows: await listProjectTeams(client, context, {
              projectId: get("projectId"),
            }),
          };
        case "tasks":
          return {
            rows: await listProjectTasks(client, context, {
              projectId: get("projectId"),
              status: get("status"),
              mine: get("mine"),
              overdue: get("overdue"),
              search: get("search"),
            }),
          };
        case "task":
          return {
            task: await getProjectTask(client, context, get("id") ?? ""),
          };
        case "wbs":
          return {
            wbs: await getProjectWbs(client, context, get("projectId") ?? ""),
          };
        case "milestones":
          return {
            rows: await listProjectMilestones(client, context, {
              projectId: get("projectId"),
              status: get("status"),
            }),
          };
        case "gantt":
          return {
            gantt: await getGanttData(client, context, get("projectId") ?? ""),
          };
        case "kanban":
          return {
            board: await getKanbanBoard(
              client,
              context,
              get("projectId") ?? "",
              { mine: get("mine") },
            ),
          };
        case "calendar":
          return {
            calendar: await getProjectCalendar(client, context, {
              projectId: get("projectId"),
              from: get("from"),
              to: get("to"),
            }),
          };
        case "progress":
          return {
            progress: await getProjectProgress(
              client,
              context,
              get("projectId") ?? "",
            ),
          };
        case "time-entries":
          return {
            rows: await listProjectTimeEntries(client, context, {
              projectId: get("projectId"),
              status: get("status"),
              from: get("from"),
              to: get("to"),
              mine: get("mine"),
            }),
          };
        case "timesheets":
          return {
            rows: await listTimesheets(client, context, {
              status: get("status"),
            }),
          };
        case "comments":
          return {
            rows: await listProjectComments(client, context, {
              entityType: get("entityType"),
              entityId: get("entityId"),
            }),
          };
        case "mentions":
          return { rows: await listMyMentions(client, context) };
        default:
          throw new HttpError(404, "Unknown Projects view.");
      }
    },
    "projects.view",
  );
}
