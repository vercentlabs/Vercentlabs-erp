// Projects — Progress Tracking, the rules: the errors, the one task-completion formula every screen and report uses, the milestone and
// schedule indicators, and the words that say what each number measures. Five different measurements stay five: task completion,
// required-milestone completion, schedule, effort used against estimate and money are never averaged into one percentage.
import { projectError } from "../project-core.js";

// Raised whenever a rule below changes, so a stored snapshot says which rules produced it.
export const CALCULATION_VERSION = 1;

const MESSAGES = Object.freeze({
  PROGRESS_PROJECT_NOT_FOUND: "This Project is not available.",
  PROGRESS_ACCESS_DENIED: "You do not have permission to view this Project's progress.",
  PROGRESS_NO_TASKS: "No Tasks have been added yet.",
  PROGRESS_SOURCE_UNAVAILABLE: "Progress cannot be refreshed right now.",
  PROGRESS_DATA_STALE: "Project activity has changed. Refreshing the progress summary.",
  PROGRESS_HISTORY_UNAVAILABLE: "Historical progress is unavailable for this period.",
  PROGRESS_BASELINE_NOT_SET: "This Project has no approved baseline yet.",
  PROGRESS_BASELINE_PERMISSION_DENIED: "You cannot change the approved progress baseline.",
  PROGRESS_SOURCE_CONFLICT: "Project work changed during calculation. Please refresh.",
  PROGRESS_RECONCILIATION_REQUIRED: "The progress summary needs recalculation from the latest Tasks and Milestones.",
  PROGRESS_INPUT_INVALID: "Check the details and try again.",
});
export const PROGRESS_MESSAGES = MESSAGES;
export const progressError = (status, code, message, details) => projectError(status, code, message ?? MESSAGES[code], details);

// Done over every task but the cancelled, to one decimal and never rounded up (99.96% is not 100%). No tasks: no number at all.
export function taskPercent(done, total) {
  if (!total) return null;
  return Math.floor((done * 1000) / total) / 10;
}
export const percentText = (value) => (value === null || value === undefined ? "—" : `${Number.isInteger(value) ? value : value.toFixed(1)}%`);
export function taskProgressOf(counts) {
  const percent = taskPercent(counts.done, counts.total);
  return {
    state: counts.total ? "TRACKED" : "NO_TASKS", measure: "Task completion", percent,
    label: counts.total ? `${percentText(percent)} task completion` : "Not available — no tasks",
    text: counts.total ? `${counts.done} of ${counts.total} task${counts.total === 1 ? "" : "s"} done` : "No tasks have been added yet.",
    ...counts,
  };
}
// Accepted required milestones over the active required ones (a waived milestone is reported apart, never as completed).
export function milestonePercent(completed, total) {
  return total ? Math.floor((completed * 1000) / total) / 10 : null;
}

// ------------------------------------------------------------------ schedule
export const SCHEDULE_LABEL = Object.freeze({
  NOT_STARTED: "Not started", ON_SCHEDULE: "On schedule", DUE_SOON: "Due soon", OVERDUE: "Overdue", ON_HOLD: "On hold", COMPLETED_ON_TIME: "Completed on time",
  COMPLETED_LATE: "Completed late", CANCELLED: "Cancelled", NO_TARGET: "No target date",
});
const days = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
// The deadline indicator and the remaining days. Elapsed schedule is shown as such — never as work done.
export function scheduleOf({ status, today, plannedStart, actualStart, target, completedAt, dueSoonDays }) {
  let indicator;
  if (status === "CANCELLED") indicator = "CANCELLED";
  else if (status === "COMPLETED") indicator = target && completedAt && completedAt > target ? "COMPLETED_LATE" : "COMPLETED_ON_TIME";
  else if (status === "DRAFT" || status === "PLANNED") indicator = "NOT_STARTED";
  else if (status === "ON_HOLD") indicator = "ON_HOLD";
  else if (!target) indicator = "NO_TARGET";
  else if (today > target) indicator = "OVERDUE";
  else if (days(today, target) <= dueSoonDays) indicator = "DUE_SOON";
  else indicator = "ON_SCHEDULE";
  const open = !["COMPLETED", "CANCELLED"].includes(status);
  const remainingDays = open && target ? days(today, target) : null;
  const start = actualStart ?? plannedStart;
  const span = start && target ? days(start, target) : null;
  const elapsedPercent = open && actualStart && span && span > 0 ? Math.max(0, Math.min(100, Math.floor((days(start, today) * 100) / span))) : null;
  return { indicator, label: SCHEDULE_LABEL[indicator], remainingDays, elapsedPercent,
    remainingText: remainingDays === null ? null : remainingDays < 0 ? `${-remainingDays} day${remainingDays === -1 ? "" : "s"} overdue` : remainingDays === 0 ? "Due today" : `${remainingDays} day${remainingDays === 1 ? "" : "s"} left`,
    completedLateDays: indicator === "COMPLETED_LATE" ? days(target, completedAt) : null };
}

// Why progress moved between two recorded points, in words a manager trusts.
export function changeKind(before, after, action) {
  if (!before) return "START";
  const total = after.task_total - before.task_total;
  const done = after.task_done - before.task_done;
  if (total > 0) return action === "CREATED" ? "ADDED" : "RESTORED";
  if (total < 0) return "CANCELLED";
  if (done > 0) return "COMPLETED";
  if (done < 0) return "REOPENED";
  if (after.milestone_required_completed !== before.milestone_required_completed || after.milestone_required_total !== before.milestone_required_total) return "MILESTONE";
  if (after.project_status !== before.project_status) return "LIFECYCLE";
  return "OTHER";
}
export const CHANGE_LABEL = Object.freeze({
  START: "Recording started", ADDED: "Task added", RESTORED: "Task brought back into scope", CANCELLED: "Task cancelled", COMPLETED: "Task completed", REOPENED: "Task reopened",
  MILESTONE: "Milestone changed", LIFECYCLE: "Project status changed", OTHER: "Recalculated",
});
// "Progress changed from 80% to 53.3% because 5 tasks were added."
export function explainWindow(first, last, kinds) {
  const from = taskPercent(first.task_done, first.task_total);
  const to = taskPercent(last.task_done, last.task_total);
  const parts = [];
  const n = (kind) => kinds.filter((k) => k === kind).length;
  const say = (count, one, many) => (count ? parts.push(count === 1 ? one : many.replace("#", count)) : null);
  say(n("ADDED"), "a task was added", "# tasks were added");
  say(n("COMPLETED"), "a task was completed", "# tasks were completed");
  say(n("REOPENED"), "a completed task was reopened", "# completed tasks were reopened");
  say(n("CANCELLED"), "a task was cancelled", "# tasks were cancelled");
  say(n("RESTORED"), "a task came back into scope", "# tasks came back into scope");
  if (from === to) return `Task completion stayed at ${percentText(to)}${parts.length ? ` (${parts.join(", ")})` : ""}.`;
  return `Task completion changed from ${percentText(from)} to ${percentText(to)}${parts.length ? ` because ${parts.join(", ")}` : ""}.`;
}
