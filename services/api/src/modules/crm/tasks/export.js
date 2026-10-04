// The task list as a file: exactly the tasks the list shows for the same view and filters.
import { CrmError } from "../data-management/errors.js";
import { requireTaskPermission } from "./access.js";
import { TASK_PERMISSIONS } from "./constants.js";
import { TASK_SELECT, buildTaskListWhere, toTask } from "./records.js";

const EXPORT_ROW_LIMIT = 10000;
const RELATED_LABELS = { lead: "Lead", opportunity: "Opportunity", party: "Account", contact: "Contact", campaign: "Campaign" };
const COLUMNS = Object.freeze([
  ["Task Number", (task) => task.number],
  ["Title", (task) => task.title],
  ["Status", (task) => (task.isOverdue ? `${task.status} (overdue)` : task.status)],
  ["Priority", (task) => task.priority],
  ["Assigned To", (task) => task.assignedName],
  ["Created By", (task) => task.createdByName],
  ["Related To", (task) => (task.relatedType ? RELATED_LABELS[task.relatedType] : "")],
  ["Related Record", (task) => task.relatedName],
  ["Account", (task) => task.accountName],
  ["Due Date", (task) => task.dueDate],
  ["Due Time", (task) => task.dueTime],
  ["Created At", (task) => task.createdAt],
  ["Completed At", (task) => task.completedAt],
  ["Completed By", (task) => task.completedByName],
  ["Description", (task) => task.description],
]);

function csvCell(value) {
  let cell = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export async function exportTasks(client, context, filters = {}) {
  requireTaskPermission(context, TASK_PERMISSIONS.export, "You do not have permission to export.");
  const values = [];
  const where = buildTaskListWhere(context, filters, values);
  const { rows } = await client.query(`${TASK_SELECT} ${where} ORDER BY task.due_at ASC NULLS LAST, task.id LIMIT ${EXPORT_ROW_LIMIT + 1}`, values);
  if (rows.length > EXPORT_ROW_LIMIT) throw new CrmError(413, `This export has more than ${EXPORT_ROW_LIMIT} tasks. Narrow the filters and try again.`, "CRM_TASK_EXPORT_TOO_LARGE");
  const tasks = rows.map(toTask);
  return {
    fileName: `tasks-${new Date().toISOString().slice(0, 10)}.csv`,
    rowCount: tasks.length,
    csv: `﻿${[COLUMNS.map(([label]) => label), ...tasks.map((task) => COLUMNS.map(([, read]) => read(task)))].map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`,
  };
}
