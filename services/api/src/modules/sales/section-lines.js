// Headings and notes inside a document's lines (Sales report Phase 2): "Installation", "Note: prices valid for Mumbai". They are not lines
// — nothing is priced, taxed or booked — but blocks kept beside the lines: each sits before item line `position` (0 = before the first,
// the number of lines = after the last). Quotations, orders and invoices keep them, carry them to the next document, and print them.
import { SalesError } from "./index.js";

const KINDS = new Set(["section", "note"]);
const MAX_BLOCKS = 100;

// input: [{ kind: "section" | "note", text, position }] for a document with `lineCount` item lines.
export function readSectionLines(value, lineCount) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SalesError(400, "Headings and notes must be a list.", "SALES_SECTION_LINES_INVALID");
  if (value.length > MAX_BLOCKS) throw new SalesError(400, `A document can hold at most ${MAX_BLOCKS} headings and notes.`, "SALES_SECTION_LINES_INVALID");
  return value.map((entry, index) => {
    const kind = String(entry?.kind ?? "");
    const text = String(entry?.text ?? "").trim().slice(0, kind === "section" ? 200 : 1000);
    const position = Number(entry?.position);
    if (!KINDS.has(kind)) throw new SalesError(400, `Heading or note ${index + 1}: choose a heading or a note.`, "SALES_SECTION_LINES_INVALID");
    if (!text) throw new SalesError(400, `${kind === "section" ? "Heading" : "Note"} ${index + 1}: enter its text.`, "SALES_SECTION_LINES_INVALID");
    if (!Number.isInteger(position) || position < 0) throw new SalesError(400, `${kind === "section" ? "Heading" : "Note"} ${index + 1}: its place is not valid.`, "SALES_SECTION_LINES_INVALID");
    return { kind, text, position: Math.min(position, Math.max(0, Number(lineCount) || 0)) };
  }).sort((a, b) => a.position - b.position);
}

// Writes the blocks on a document row (a quotation or order version, or a sales invoice) and returns them.
export async function saveSectionLines(client, table, keyColumn, keyValue, blocks) {
  await client.query(`UPDATE ${table} SET section_lines = $2::jsonb WHERE ${keyColumn} = $1`, [keyValue, JSON.stringify(blocks)]);
  return blocks;
}

// The blocks of a document carried to one made from part of its lines (an invoice for some of an order's lines): `kept` are the indexes
// (in order) of the source lines the new document has. A block keeps its place before the same line, or the next kept one.
export function carrySectionLines(blocks, kept) {
  const sorted = [...kept].sort((a, b) => a - b);
  return (Array.isArray(blocks) ? blocks : []).map((block) => ({ ...block, position: sorted.filter((index) => index < block.position).length }));
}

// The table rows of a printed document with the blocks put in place: a heading is a bold row across the table, a note a plain one.
export function rowsWithSections(rows, blocks) {
  const list = Array.isArray(blocks) ? [...blocks].sort((a, b) => a.position - b.position) : [];
  if (!list.length) return rows;
  const out = [];
  let next = 0;
  rows.forEach((row, index) => {
    while (next < list.length && list[next].position <= index) out.push(blockRow(list[next++]));
    out.push(row);
  });
  while (next < list.length) out.push(blockRow(list[next++]));
  return out;
}

const blockRow = (block) => (block.kind === "section" ? { __section: block.text } : { __note: block.text });
