import { HttpError } from "@/lib/http";
import { csvCell as reportCsvCell } from "@vercent/reporting-engine";

function serialise(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function csvCell(value: unknown) {
  return reportCsvCell(serialise(value));
}

export function parseCsv(input: string) {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        value += character;
      }
      continue;
    }

    if (character === '"' && value.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value);
      value = "";
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
    } else {
      value += character;
    }
  }

  if (quoted)
    throw new HttpError(400, "CSV contains an unterminated quoted field.");
  row.push(value);
  if (row.some((cell) => cell.length > 0)) rows.push(row);

  if (!rows.length) throw new HttpError(400, "CSV is empty.");
  const width = rows[0].length;
  if (!width) throw new HttpError(400, "CSV header is empty.");
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index].length !== width) {
      throw new HttpError(
        400,
        `CSV row ${index + 1} has ${rows[index].length} columns; expected ${width}.`,
      );
    }
  }
  return rows;
}
