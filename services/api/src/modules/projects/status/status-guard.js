// Projects — Project Status, the execution guard: the one answer to "may this work proceed on this project now?". Tasks and milestones ask
// executionState (status-rules) inside their own commands; any other module (time tracking, expenses, purchasing) asks here, always on the
// server and against the project as it is now — never a status cached in a browser.
//
// action: "view" (read), "plan" (create or edit planned work, reassign, comment, record hold evidence: open or on hold), "execute" (start or
// finish work, tick a checklist, submit for review: in progress only), "record_time" (log time or expenses: in progress, or work performed
// before a hold or completion began — the service date decides, not today's status).
import { STATUS_LABEL, isoDay, visibleProject } from "../project-core.js";
import { executionState, statusError } from "./status-rules.js";

export async function validateProjectExecutionAllowed(client, c, projectId, action = "execute", context = {}) {
  const { project, access } = await visibleProject(client, c, projectId);
  if (action === "view") return { allowed: true, status: project.status };
  if (!access.can.contribute) throw statusError(403, "PROJECT_STATUS_PERMISSION_DENIED", "You are not on this project's team.");
  if (context.expectedVersion !== undefined && context.expectedVersion !== null && Number(context.expectedVersion) !== Number(project.row_version)) throw statusError(409, "PROJECT_STATUS_VERSION_CONFLICT");
  const state = executionState(project);
  if (action === "plan") {
    if (state === "CLOSED") throw statusError(409, "PROJECT_STATUS_INVALID_TRANSITION", `The project is ${project.archived_at ? "archived" : STATUS_LABEL[project.status].toLowerCase()}: its work is read-only.`);
    return { allowed: true, status: project.status };
  }
  if (action === "record_time") {
    if (state === "OPEN") return { allowed: true, status: project.status };
    const serviceDate = context.serviceDate ? isoDay(context.serviceDate) : null;
    const windowEnd = await executionWindowEnd(client, c, project);
    if (serviceDate && windowEnd && serviceDate < windowEnd && project.actual_start_date && serviceDate >= isoDay(project.actual_start_date))
      return { allowed: true, status: project.status, note: "Work performed while the project was in progress." };
    throw statusError(409, state === "ON_HOLD" ? "PROJECT_STATUS_HOLD_ALREADY_ACTIVE" : "PROJECT_STATUS_INVALID_TRANSITION",
      state === "ON_HOLD" ? "The project is on hold: new time is not recorded for work after the hold began." : `The project is ${STATUS_LABEL[project.status].toLowerCase()}: new work is not recorded.`);
  }
  if (state === "OPEN") return { allowed: true, status: project.status };
  if (state === "ON_HOLD") throw statusError(409, "PROJECT_STATUS_HOLD_ALREADY_ACTIVE", "The project is on hold: ordinary work waits until it resumes.");
  throw statusError(409, "PROJECT_STATUS_INVALID_TRANSITION", state === "NOT_STARTED" ? "Start the project before its work begins." : `The project is ${STATUS_LABEL[project.status].toLowerCase()}: its work is read-only.`);
}
// The day execution stopped (the active hold's start, or the completion / cancellation day); work before it may still be recorded.
async function executionWindowEnd(client, c, project) {
  if (project.status === "ON_HOLD") {
    const hold = (await client.query(`SELECT started_at FROM tenant.project_holds WHERE organization_id = $1 AND project_id = $2 AND resolved_at IS NULL`, [c.organizationId, project.id])).rows[0];
    return hold ? isoDay(hold.started_at) : null;
  }
  if (project.status === "COMPLETED") return project.completed_at ? isoDay(project.completed_at) : null;
  if (project.status === "CANCELLED") return project.cancelled_at ? isoDay(project.cancelled_at) : null;
  return null;
}
