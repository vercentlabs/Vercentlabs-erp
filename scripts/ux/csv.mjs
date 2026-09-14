// Minimal, dependency-free RFC-4180-ish CSV reader/writer shared by the UX
// traceability generator and verifier. The registers under docs/02-register
// contain quoted fields with embedded commas and quotes, so a naive
// String.split(",") corrupts rows -- this handles quoting properly.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // skip
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function readCsvRecords(text) {
  const rows = parseCsv(text).filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
  const header = rows[0];
  return rows.slice(1).map((row) => Object.fromEntries(header.map((h, i) => [h, row[i] ?? ""])));
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function writeCsv(header, records) {
  const lines = [header.join(",")];
  for (const record of records) {
    lines.push(header.map((key) => csvEscape(record[key])).join(","));
  }
  return lines.join("\n") + "\n";
}
