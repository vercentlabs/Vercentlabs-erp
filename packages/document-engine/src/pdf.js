// Server-side PDF rendering (pure Node: @react-pdf/renderer, no browser).
// A document is rendered from a plain, validated DOCUMENT MODEL built by a
// registered renderer from an authorised domain read - never from HTML,
// templates on disk, or user-supplied markup. Built-in Helvetica only, so no
// font deployment is needed.
//
// Model: { title, documentNumber, issuedAt, organizationName, status,
//          parties: [{ label, lines: [string] }], fields: [{ label, value }],
//          table: { columns: [{ key, label, align, width }], rows: [{...}] },
//          totals: [{ label, value, emphasis }], notes: [{ label, text }], footer }
import { createElement as h } from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 36, fontFamily: "Helvetica", fontSize: 9, color: "#0f172a" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 18 },
  organization: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", textAlign: "right" },
  subtitle: { fontSize: 9, color: "#475569", textAlign: "right", marginTop: 2 },
  parties: { flexDirection: "row", gap: 16, marginBottom: 12 },
  party: { flex: 1 },
  label: { fontSize: 7, color: "#64748b", textTransform: "uppercase", marginBottom: 2 },
  fields: { flexDirection: "row", flexWrap: "wrap", marginBottom: 12 },
  field: { width: "33%", marginBottom: 6 },
  tableHeader: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#cbd5e1", paddingBottom: 4, marginBottom: 2 },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0", paddingVertical: 3 },
  headerCell: { fontFamily: "Helvetica-Bold", fontSize: 8 },
  totals: { alignSelf: "flex-end", width: "45%", marginTop: 10 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  totalEmphasis: { fontFamily: "Helvetica-Bold", fontSize: 11, borderTopWidth: 1, borderTopColor: "#0f172a", paddingTop: 4, marginTop: 2 },
  notes: { marginTop: 16 },
  footer: { position: "absolute", bottom: 20, left: 36, right: 36, fontSize: 7, color: "#94a3b8", textAlign: "center" },
});

const text = (value, max = 500) => (value === null || value === undefined ? "" : String(value).slice(0, max));

function cell(column, value, header = false) {
  return h(
    Text,
    { key: column.key, style: [{ width: column.width || `${100 / 6}%`, textAlign: column.align || "left", paddingRight: 4 }, header ? styles.headerCell : null] },
    text(value, 300),
  );
}

export function validateDocumentModel(model) {
  if (!model || typeof model !== "object") throw new TypeError("A document model is required.");
  if (!text(model.title)) throw new TypeError("A document needs a title.");
  if (model.table && (!Array.isArray(model.table.columns) || !Array.isArray(model.table.rows))) throw new TypeError("A document table needs columns and rows.");
  if (model.table && model.table.rows.length > 2000) throw new RangeError("A document can hold at most 2000 lines.");
  return model;
}

export async function renderDocumentPdf(model) {
  validateDocumentModel(model);
  const table = model.table;
  const page = h(
    Page,
    { size: "A4", style: styles.page },
    h(
      View,
      { style: styles.header },
      h(View, null, h(Text, { style: styles.organization }, text(model.organizationName, 200))),
      h(
        View,
        null,
        h(Text, { style: styles.title }, text(model.title, 120)),
        model.documentNumber ? h(Text, { style: styles.subtitle }, text(model.documentNumber, 80)) : null,
        model.issuedAt ? h(Text, { style: styles.subtitle }, text(model.issuedAt, 80)) : null,
        model.status ? h(Text, { style: styles.subtitle }, text(model.status, 60)) : null,
      ),
    ),
    model.parties?.length
      ? h(
          View,
          { style: styles.parties },
          ...model.parties.map((party, index) => h(View, { key: `p${index}`, style: styles.party }, h(Text, { style: styles.label }, text(party.label, 60)), ...(party.lines || []).map((line, lineIndex) => h(Text, { key: `l${lineIndex}` }, text(line, 200))))),
        )
      : null,
    model.fields?.length
      ? h(View, { style: styles.fields }, ...model.fields.map((field, index) => h(View, { key: `f${index}`, style: styles.field }, h(Text, { style: styles.label }, text(field.label, 60)), h(Text, null, text(field.value, 200)))))
      : null,
    table
      ? h(
          View,
          null,
          h(View, { style: styles.tableHeader, fixed: true }, ...table.columns.map((column) => cell(column, column.label, true))),
          ...table.rows.map((row, index) => h(View, { key: `r${index}`, style: styles.tableRow, wrap: false }, ...table.columns.map((column) => cell(column, row[column.key])))),
        )
      : null,
    model.totals?.length
      ? h(
          View,
          { style: styles.totals },
          ...model.totals.map((total, index) => h(View, { key: `t${index}`, style: [styles.totalRow, total.emphasis ? styles.totalEmphasis : null] }, h(Text, null, text(total.label, 60)), h(Text, null, text(total.value, 60)))),
        )
      : null,
    model.notes?.length ? h(View, { style: styles.notes }, ...model.notes.map((note, index) => h(View, { key: `n${index}`, style: { marginBottom: 6 } }, h(Text, { style: styles.label }, text(note.label, 60)), h(Text, null, text(note.text, 4000))))) : null,
    h(Text, { style: styles.footer, fixed: true, render: ({ pageNumber, totalPages }) => `${text(model.footer, 200)}${model.footer ? " · " : ""}Page ${pageNumber} of ${totalPages}` }),
  );
  return renderToBuffer(h(Document, { title: text(model.title, 120), author: text(model.organizationName, 120), creator: "Vercentlabs ERP", producer: "Vercentlabs ERP" }, page));
}

// A safe download name: letters, digits, dot, dash, underscore; always .pdf.
export function safePdfFileName(base) {
  const cleaned = String(base || "document").normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 100);
  return `${cleaned || "document"}.pdf`;
}
