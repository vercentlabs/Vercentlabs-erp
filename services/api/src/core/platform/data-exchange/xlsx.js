// Reads the first worksheet of an .xlsx upload into the same shape
// parseCsvUpload returns ({ headers, records, rowCount }), so an importing
// module treats both file types alike. An .xlsx file is a ZIP of XML parts;
// only what a flat data sheet needs is read: shared strings, inline strings,
// numbers and booleans. Formulas use their cached value; dates arrive as the
// text or number the cell holds.
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

import { CSV_LIMITS, DataExchangeError } from "./csv.js";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

function invalid(message = "The file is not a valid .xlsx workbook.") {
  return new DataExchangeError(400, message, "XLSX_INVALID");
}

// name -> Buffer for every entry in the archive.
function readZipEntries(buffer) {
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) { end = offset; break; }
  }
  if (end < 0) throw invalid();
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) throw invalid();
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (!/^xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(name)) continue;
    total += uncompressedSize;
    if (total > MAX_UNCOMPRESSED_BYTES) throw new DataExchangeError(413, "The workbook is too large to import.", "XLSX_TOO_LARGE");
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) entries.set(name, data);
    else if (method === 8) entries.set(name, inflateRawSync(data, { maxOutputLength: MAX_UNCOMPRESSED_BYTES }));
    else throw invalid();
  }
  return entries;
}

function decodeXml(value) {
  return value
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&amp;/g, "&");
}

// All <t> runs inside one string item, concatenated.
function stringItemText(xml) {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1])).join("");
}

function columnIndex(reference) {
  let index = 0;
  for (const character of reference.replace(/\d+$/, "")) index = index * 26 + (character.charCodeAt(0) - 64);
  return index - 1;
}

function firstSheetPath(entries) {
  const workbook = entries.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const relations = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const relationId = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1];
  const target = relationId ? new RegExp(`<Relationship\\b[^>]*\\bId="${relationId}"[^>]*\\bTarget="([^"]+)"|<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${relationId}"`).exec(relations) : null;
  const path = target ? (target[1] || target[2]).replace(/^\/?(xl\/)?/, "xl/") : "xl/worksheets/sheet1.xml";
  return entries.has(path) ? path : [...entries.keys()].find((name) => name.startsWith("xl/worksheets/"));
}

export function parseXlsxUpload(bytes, limits = {}) {
  const { maxBytes, maxRows, maxColumns, maxFieldLength } = { ...CSV_LIMITS, ...limits };
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  if (buffer.length === 0) throw new DataExchangeError(400, "The file is empty.", "XLSX_EMPTY");
  if (buffer.length > maxBytes) throw new DataExchangeError(413, `The file is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`, "XLSX_TOO_LARGE");
  let entries;
  try {
    entries = readZipEntries(buffer);
  } catch (error) {
    if (error instanceof DataExchangeError) throw error;
    throw invalid();
  }
  const sheetPath = firstSheetPath(entries);
  if (!sheetPath) throw invalid();
  const sharedStrings = [...(entries.get("xl/sharedStrings.xml")?.toString("utf8") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => stringItemText(match[1]));

  const rows = [];
  for (const rowMatch of entries.get(sheetPath).toString("utf8").matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cell of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const reference = /\br="([A-Z]+\d+)"/.exec(cell[1])?.[1];
      const type = /\bt="([^"]+)"/.exec(cell[1])?.[1];
      const body = cell[2] ?? "";
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
      let value = decodeXml(raw);
      if (type === "s") value = sharedStrings[Number(raw)] ?? "";
      else if (type === "inlineStr") value = stringItemText(body);
      else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
      const index = reference ? columnIndex(reference) : cells.length;
      if (index >= maxColumns) throw new DataExchangeError(400, `The sheet has more than ${maxColumns} columns.`, "XLSX_TOO_MANY_COLUMNS");
      cells[index] = String(value).trim();
    }
    if (cells.some((value) => value)) rows.push(cells);
    if (rows.length > maxRows + 1) throw new DataExchangeError(413, `The sheet has more than ${maxRows} rows. Split it into smaller files.`, "XLSX_TOO_MANY_ROWS");
  }
  if (!rows.length) throw new DataExchangeError(400, "The sheet has no header row.", "XLSX_EMPTY");

  const headers = Array.from(rows[0], (header) => String(header ?? "").trim());
  const seen = new Set();
  headers.forEach((header, index) => {
    if (!header) throw new DataExchangeError(400, `Column ${index + 1} has no header.`, "XLSX_HEADER_EMPTY");
    const key = header.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) throw new DataExchangeError(400, `The column "${header.slice(0, 60)}" appears more than once.`, "XLSX_DUPLICATE_HEADER");
    seen.add(key);
  });
  const records = rows.slice(1).map((row, rowIndex) => Object.fromEntries(headers.map((header, column) => {
    const value = row[column] ?? "";
    if (value.length > maxFieldLength)
      throw new DataExchangeError(400, `Row ${rowIndex + 2}, column "${header.slice(0, 60)}" is longer than ${maxFieldLength} characters.`, "XLSX_FIELD_TOO_LONG");
    return [header, value];
  })));
  return { headers, records, rowCount: records.length };
}

// Picks the parser from the file name.
export function isXlsxFileName(fileName) {
  return /\.xlsx$/i.test(String(fileName ?? ""));
}

// Writes a one-sheet workbook: columns [{ key, label }], rows of plain values (numbers stay numbers; text is neutralized against formula
// injection, like a CSV export).
export function buildXlsxWorkbook({ sheetName = "Sheet1", columns, rows }) {
  const escape = (value) => String(value).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch])
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  const letters = (index) => { let out = ""; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out; return out; };
  const cell = (value, ref) => {
    if (value === null || value === undefined || value === "") return "";
    if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
    const text = String(value);
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escape(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text)}</t></is></c>`;
  };
  const sheetRows = [columns.map((column) => column.label), ...rows.map((row) => columns.map((column) => row[column.key]))]
    .map((values, r) => `<row r="${r + 1}">${values.map((value, i) => cell(value, `${letters(i)}${r + 1}`)).join("")}</row>`).join("");
  const name = escape(String(sheetName).replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1");
  const header = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const parts = [
    ["[Content_Types].xml", `${header}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
    ["_rels/.rels", `${header}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `${header}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `${header}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
    ["xl/worksheets/sheet1.xml", `${header}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`],
  ];
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [path, xml] of parts) {
    const data = Buffer.from(xml, "utf8");
    const packed = deflateRawSync(data);
    const fileName = Buffer.from(path, "utf8");
    const sum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(sum, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(fileName.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_FILE_HEADER, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(sum, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, fileName, packed);
    centrals.push(central, fileName);
    offset += local.length + fileName.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0); end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
