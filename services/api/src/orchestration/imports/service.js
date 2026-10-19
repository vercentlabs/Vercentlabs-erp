// Running a shared import (registry.js): read the file (CSV in UTF-8, UTF-16 or Excel's Windows-1252, or XLSX), propose a column
// mapping, then check (dry run: everything rolled back) or import. Each row (or group of rows) is its own savepoint, so one bad row
// never fails the file and each says what happened. The template and the "rows to fix" file are CSV.
import { hasSessionPermission } from "../../core/access/index.js";
import { parseCsvUpload } from "../../core/platform/data-exchange/csv.js";
import { isXlsxFileName, parseXlsxUpload } from "../../core/platform/data-exchange/xlsx.js";
import { IMPORTERS, getImporter, importLookups } from "./registry.js";

export const IMPORT_ROW_LIMIT = 5000;

export class ImportError extends Error {
  constructor(status, message, code = "IMPORT_INVALID") {
    super(message);
    this.name = "ImportError";
    this.status = status;
    this.code = code;
  }
}

const headerKey = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();
function csvCell(value) {
  let cell = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}
const toCsv = (rows) => `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;

function visible(session, accessibleModules, importer) {
  return new Set(accessibleModules ?? []).has(importer.moduleKey) && importer.permissions.some((permission) => hasSessionPermission(session, permission));
}

export function listImporters(session, accessibleModules) {
  return IMPORTERS.filter((importer) => visible(session, accessibleModules, importer))
    .map(({ key, moduleKey, label, description, fields, groupBy }) => ({ key, moduleKey, label, description, groupBy: groupBy ?? null, fields: fields.map(({ key: k, label: l, required }) => ({ key: k, label: l, required: Boolean(required) })) }));
}

function importerFor(session, accessibleModules, importerKey) {
  const importer = getImporter(importerKey);
  if (!importer) throw new ImportError(404, "There is no such import.", "IMPORT_UNKNOWN");
  if (!visible(session, accessibleModules, importer)) throw new ImportError(403, "You cannot use this import.", "IMPORT_FORBIDDEN");
  return importer;
}

export function buildImportTemplate(importerKey) {
  const importer = getImporter(importerKey);
  if (!importer) throw new ImportError(404, "There is no such import.", "IMPORT_UNKNOWN");
  return toCsv([importer.fields.map((field) => field.label), importer.fields.map((field) => field.sample ?? "")]);
}

const parseUpload = (bytes, fileName) =>
  (isXlsxFileName(fileName) ? parseXlsxUpload(bytes, { maxRows: IMPORT_ROW_LIMIT }) : parseCsvUpload(bytes, { maxRows: IMPORT_ROW_LIMIT }));

export function suggestImportMapping(importer, headers) {
  const mapping = {};
  const taken = new Set();
  for (const header of headers) {
    const k = headerKey(header);
    const field = importer.fields.find((entry) => !taken.has(entry.key) && (headerKey(entry.label) === k || headerKey(entry.key) === k || (entry.aliases ?? []).includes(k)));
    if (field) { mapping[header] = field.key; taken.add(field.key); }
  }
  return mapping;
}

// Step 1: read the file and propose a column mapping.
export function analyzeImport(session, accessibleModules, importerKey, { bytes, fileName }) {
  const importer = importerFor(session, accessibleModules, importerKey);
  const parsed = parseUpload(bytes, fileName);
  return { importer: importer.key, fileName, headers: parsed.headers, rowCount: parsed.rowCount ?? parsed.records.length, sampleRows: parsed.records.slice(0, 5),
    suggestedMapping: suggestImportMapping(importer, parsed.headers), fields: importer.fields.map(({ key, label, required }) => ({ key, label, required: Boolean(required) })) };
}

function rowValues(importer, record, mapping) {
  const fieldKeys = new Set(importer.fields.map((field) => field.key));
  const values = {};
  for (const [header, fieldKey] of Object.entries(mapping)) {
    if (!fieldKeys.has(fieldKey)) continue;
    // A leading ' is the spreadsheet guard templates add before =, +, - or @.
    const value = String(record[header] ?? "").replace(/^'(?=[=+\-@])/, "").trim();
    if (value) values[fieldKey] = value.slice(0, 2000);
  }
  return values;
}

// Step 2: check (dryRun) or import. mapping: { header: fieldKey } (the suggestion when left out).
export async function runImport(client, session, accessibleModules, importerKey, { bytes, fileName, mapping = null, dryRun = false }) {
  const importer = importerFor(session, accessibleModules, importerKey);
  const parsed = parseUpload(bytes, fileName);
  const chosen = mapping && Object.keys(mapping).length ? mapping : suggestImportMapping(importer, parsed.headers);
  const unknown = Object.keys(chosen).filter((header) => !parsed.headers.includes(header));
  if (unknown.length) throw new ImportError(400, `The file has no column named "${unknown[0]}".`, "IMPORT_MAPPING");
  const missing = importer.fields.filter((field) => field.required && !Object.values(chosen).includes(field.key));
  if (missing.length) throw new ImportError(400, `Choose the column for ${missing.map((field) => field.label).join(", ")}.`, "IMPORT_MAPPING");

  // Rows, or groups of rows (in the order they first appear) for an importer with groupBy.
  const units = [];
  const groups = new Map();
  for (const [index, record] of parsed.records.entries()) {
    const values = rowValues(importer, record, chosen);
    if (importer.groupBy && values[importer.groupBy]) {
      const groupKey = values[importer.groupBy].toLowerCase();
      if (!groups.has(groupKey)) { groups.set(groupKey, { rowNumbers: [], values: [] }); units.push(groups.get(groupKey)); }
      groups.get(groupKey).rowNumbers.push(index + 2);
      groups.get(groupKey).values.push(values);
    } else units.push({ rowNumbers: [index + 2], values: importer.groupBy ? [values] : values });
  }

  const context = { organizationId: session.organizationId, userId: session.userId, permissions: session.permissions, roleSlugs: session.roleSlugs };
  const find = importLookups(client, context);
  const results = [];
  await client.query("SAVEPOINT shared_import");
  for (const unit of units) {
    const rows = Array.isArray(unit.values) ? unit.values : [unit.values];
    const label = rows[0]?.[importer.groupBy ?? importer.fields.find((field) => field.required)?.key] ?? null;
    await client.query("SAVEPOINT shared_import_row");
    try {
      for (const row of rows)
        for (const field of importer.fields) if (field.required && !row[field.key]) throw Object.assign(new Error(`Missing ${field.label}.`), { status: 400, details: { field: field.key } });
      const done = await importer.importRow(client, context, unit.values, find);
      await client.query("RELEASE SAVEPOINT shared_import_row");
      results.push({ rows: unit.rowNumbers, label, outcome: "created", reference: dryRun ? null : done?.reference ?? null, message: dryRun ? "Ready to import." : done?.message ?? "Imported." });
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT shared_import_row");
      if (!error?.status || error.status >= 500) throw error;
      results.push({ rows: unit.rowNumbers, label, outcome: error.status === 409 ? "duplicate" : "failed", message: String(error.message).slice(0, 500), field: error.details?.field ?? error.details?.issues?.[0]?.field ?? null });
    }
  }
  if (dryRun) await client.query("ROLLBACK TO SAVEPOINT shared_import");
  await client.query("RELEASE SAVEPOINT shared_import");
  const count = (outcome) => results.filter((result) => result.outcome === outcome).length;
  return { importer: importer.key, dryRun: Boolean(dryRun), total: results.length, created: count("created"), duplicates: count("duplicate"), failed: count("failed"), results };
}

// The rows that did not import, as a CSV to correct and upload again.
export function buildImportErrorFile(results) {
  return toCsv([["Rows", "Record", "Result", "Reason"],
    ...results.filter((result) => result.outcome !== "created").map((result) => [result.rows.join(" "), result.label ?? "", result.outcome, result.message])]);
}
