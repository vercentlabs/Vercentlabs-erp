// The follow-up list as a file: exactly what the list shows for the same view and filters.
import { CrmError } from "../data-management/errors.js";
import { requireFollowUpPermission } from "./access.js";
import { FOLLOW_UP_PERMISSIONS } from "./constants.js";
import { FOLLOW_UP_SELECT, buildFollowUpListWhere, toFollowUp, typeLabel } from "./records.js";

const LIMIT = 10000;
const RELATED_LABELS = { lead: "Lead", opportunity: "Opportunity", party: "Account", contact: "Contact" };
const COLUMNS = Object.freeze([
  ["Follow-up Number", (row) => row.number],
  ["Subject", (row) => row.subject],
  ["Type", (row) => typeLabel(row.type)],
  ["Status", (row) => (row.isOverdue ? "scheduled (overdue)" : row.status)],
  ["Scheduled Date", (row) => row.scheduledDate],
  ["Scheduled Time", (row) => row.scheduledTime],
  ["Assigned To", (row) => row.assignedName],
  ["Related To", (row) => (row.relatedType ? RELATED_LABELS[row.relatedType] : "")],
  ["Related Record", (row) => row.relatedName],
  ["Contact", (row) => row.contactName],
  ["Account", (row) => row.accountName],
  ["Outcome", (row) => row.outcomeLabel],
  ["Created By", (row) => row.createdByName],
  ["Created At", (row) => row.createdAt],
  ["Completed At", (row) => row.completedAt],
  ["Completed By", (row) => row.completedByName],
  ["Notes", (row) => row.notes],
]);

function csvCell(value) {
  let cell = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export async function exportFollowUps(client, context, filters = {}) {
  requireFollowUpPermission(context, FOLLOW_UP_PERMISSIONS.export, "You do not have permission to export.");
  const values = [];
  const where = buildFollowUpListWhere(context, filters, values);
  const { rows } = await client.query(`${FOLLOW_UP_SELECT} ${where} ORDER BY follow_up.due_at ASC NULLS LAST, follow_up.id LIMIT ${LIMIT + 1}`, values);
  if (rows.length > LIMIT) throw new CrmError(413, `This export has more than ${LIMIT} follow-ups. Narrow the filters and try again.`, "CRM_FOLLOW_UP_EXPORT_TOO_LARGE");
  const list = rows.map(toFollowUp);
  return {
    fileName: `follow-ups-${new Date().toISOString().slice(0, 10)}.csv`,
    rowCount: list.length,
    csv: `﻿${[COLUMNS.map(([label]) => label), ...list.map((row) => COLUMNS.map(([, read]) => read(row)))].map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`,
  };
}
