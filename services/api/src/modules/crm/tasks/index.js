// CRM Tasks: a piece of work with one owner and a due date, usually about a
// lead, account, contact or opportunity. Each action is one operation
// (createTask, assignTask, completeTask, …) taking (client, context, …) and
// running inside the caller's transaction.
//
// A task answers "what work must somebody do?". A follow-up answers "when do
// we contact this customer again?" and lives in ../activities/follow-ups;
// completing a task can schedule the next follow-up.
export * from "./constants.js";
export { canViewAllTasks, taskCan, taskCapabilities, taskScopeSql } from "./access.js";
export { createTask, deleteTask, getTask, getTaskOptions, getTaskSummary, listTasks, rescheduleTask, updateTask } from "./records.js";
export {
  assignTask, bulkAssignTasks, bulkUpdateTasks, cancelTask, completeTask, listTaskHistory, reassignTask, reopenTask, settleOpenTasks, startTask,
} from "./lifecycle.js";
export { exportTasks } from "./export.js";
