// A small RFC4180-style parser (quoted fields, escaped "" inside quotes,
// quoted fields spanning newlines) for the lead-import file upload. F021
// Stage A2 §9: the writer half (toCsv/downloadCsv) was removed from here
// — it had no formula-injection protection and export now generates CSV
// server-side via rowsToCsv/csvCell (@vercentlabs/reporting-engine, the
// correctly-neutralizing shared writer), not client-side.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  while (i < normalized.length) {
    const char = normalized[i];
    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

export function rowsToObjects(rows: string[][]): { headers: string[]; records: Record<string, string>[] } {
  const [headers = [], ...rest] = rows;
  const records = rest.map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = cells[index] ?? "";
    });
    return record;
  });
  return { headers, records };
}
