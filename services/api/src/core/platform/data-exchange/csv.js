// Authoritative server-side CSV parsing for imports (the browser only uploads
// the file). Built on csv-parse (RFC 4180: quoted fields, "" escapes, newlines
// inside quotes) with platform limits:
//   UTF-8 (a leading BOM is removed), UTF-16 with a BOM (Excel's "Unicode text"), or else Windows-1252 (what Excel's plain
//   "CSV (Comma delimited)" writes on Windows: ₹ is not in it, but é, – and smart quotes are); header row required, no empty or
//   duplicate headers (case/space-insensitive), consistent column counts,
//   caps on rows, columns and field length, and on the upload size.
// Values are returned as plain strings; the importing module owns meaning.
import { parse } from "csv-parse/sync";

export class DataExchangeError extends Error {
  constructor(status, message, code = "DATA_EXCHANGE_ERROR", details) {
    super(message);
    this.name = "DataExchangeError";
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}

// The text of an uploaded CSV, or null for a binary file (a NUL byte outside UTF-16).
export function decodeCsvText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder("utf-16le").decode(buffer.subarray(2));
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder("utf-16be").decode(buffer.subarray(2));
  if (buffer.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

export const CSV_LIMITS = Object.freeze({ maxBytes: 5 * 1024 * 1024, maxRows: 5000, maxColumns: 100, maxFieldLength: 5000 });

export function parseCsvUpload(bytes, limits = {}) {
  const { maxBytes, maxRows, maxColumns, maxFieldLength } = { ...CSV_LIMITS, ...limits };
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  if (buffer.length === 0) throw new DataExchangeError(400, "The file is empty.", "CSV_EMPTY");
  if (buffer.length > maxBytes) throw new DataExchangeError(413, `The file is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`, "CSV_TOO_LARGE");
  let text = decodeCsvText(buffer);
  if (text === null) throw new DataExchangeError(400, "This is not a CSV text file. Save it as CSV from Excel and upload it again.", "CSV_ENCODING_INVALID");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  let rows;
  try {
    rows = parse(text, { bom: false, relax_column_count: false, skip_empty_lines: true, max_record_size: maxFieldLength * maxColumns, to_line: maxRows + 2 });
  } catch (error) {
    const line = Number(error?.lines) || null;
    throw new DataExchangeError(400, `The CSV is malformed${line ? ` near line ${line}` : ""}: ${String(error?.message || "").split("\n")[0].slice(0, 160)}`, "CSV_MALFORMED");
  }
  if (!rows.length) throw new DataExchangeError(400, "The file has no header row.", "CSV_EMPTY");
  const headers = rows[0].map((header) => String(header).trim());
  if (headers.length > maxColumns) throw new DataExchangeError(400, `The file has more than ${maxColumns} columns.`, "CSV_TOO_MANY_COLUMNS");
  const seen = new Map();
  headers.forEach((header, index) => {
    if (!header) throw new DataExchangeError(400, `Column ${index + 1} has no header.`, "CSV_HEADER_EMPTY");
    const key = header.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) throw new DataExchangeError(400, `The column "${header.slice(0, 60)}" appears more than once.`, "CSV_DUPLICATE_HEADER");
    seen.set(key, index);
  });
  const dataRows = rows.slice(1);
  if (dataRows.length > maxRows) throw new DataExchangeError(413, `The file has more than ${maxRows} rows. Split it into smaller files.`, "CSV_TOO_MANY_ROWS");
  const records = dataRows.map((row, rowIndex) => {
    const record = {};
    row.forEach((value, column) => {
      if (String(value).length > maxFieldLength) throw new DataExchangeError(400, `Row ${rowIndex + 2}, column "${headers[column].slice(0, 60)}" is longer than ${maxFieldLength} characters.`, "CSV_FIELD_TOO_LONG");
      record[headers[column]] = String(value);
    });
    return record;
  });
  return { headers, records, rowCount: records.length };
}
