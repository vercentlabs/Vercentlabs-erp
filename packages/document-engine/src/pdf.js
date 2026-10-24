// Server-side PDF rendering (pure Node: @react-pdf/renderer, no browser).
// A document is rendered from a plain, validated DOCUMENT MODEL built by a
// registered renderer from an authorised domain read - never from HTML,
// templates on disk, or user-supplied markup.
//
// Fonts (Shared Platform plan 4): Noto Sans with Noto Sans Devanagari as the fallback, embedded from ../fonts (SIL OFL 1.1), so ₹ and
// Hindi/Marathi text print. Layout v2 adds, all optional: the company's logo and details in the header, a brand colour, the
// amount in words, a summary table (the HSN-wise tax summary), bank details with a UPI QR code, the authorised signatory block with
// a signature image, and copies (Original / Duplicate / Triplicate — one set of pages per copy, its name on each page).
//
// Model: { title, documentNumber, issuedAt, organizationName, status,
//          company?: { logo?: Buffer, lines?: [string] }, brandColor?, layout?: "classic" | "compact",
//          parties: [{ label, lines: [string] }], fields: [{ label, value }],
//          table: { columns: [{ key, label, align, width }], rows: [{...}] },
//          totals: [{ label, value, emphasis }], amountInWords?,
//          summaryTable?: { title, columns, rows, totalRow? },
//          payment?: { bankLines?: [string], upi?: { uri, label } }, einvoiceQr?: string (the signed QR of an e-invoice),
//          signatory?: { companyName, label?, image?: Buffer },
//          notes: [{ label, text }], declaration?, copies?: [string], footer }
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";

const font = (name) => fileURLToPath(new URL(`../fonts/${name}`, import.meta.url));
let fontsRegistered = false;
function registerFonts() {
  if (fontsRegistered) return;
  Font.register({ family: "NotoSans", fonts: [{ src: font("NotoSans-Regular.ttf") }, { src: font("NotoSans-Bold.ttf"), fontWeight: 700 }] });
  Font.register({ family: "NotoSansDevanagari", fonts: [{ src: font("NotoSansDevanagari-Regular.ttf") }, { src: font("NotoSansDevanagari-Bold.ttf"), fontWeight: 700 }] });
  // Words are never hyphenated (amounts, names, GSTINs).
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}
const FAMILY = ["NotoSans", "NotoSansDevanagari"];
const BOLD = { fontWeight: 700 };
const HEX = /^#[0-9a-fA-F]{6}$/;

const styles = StyleSheet.create({
  page: { padding: 32, paddingBottom: 44, fontFamily: FAMILY, fontSize: 8.5, color: "#0f172a" },
  compactPage: { padding: 24, paddingBottom: 38, fontFamily: FAMILY, fontSize: 8, color: "#0f172a" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14, paddingBottom: 10, borderBottomWidth: 1.5 },
  companyBlock: { flexDirection: "row", gap: 10, maxWidth: "60%" },
  logo: { width: 64, height: 48, objectFit: "contain" },
  organization: { fontSize: 12, ...BOLD },
  companyLine: { fontSize: 7.5, color: "#475569" },
  title: { fontSize: 15, ...BOLD, textAlign: "right" },
  subtitle: { fontSize: 8.5, color: "#475569", textAlign: "right", marginTop: 2 },
  copy: { fontSize: 7.5, textAlign: "right", marginTop: 3, ...BOLD },
  parties: { flexDirection: "row", gap: 14, marginBottom: 10 },
  party: { flex: 1, borderWidth: 0.5, borderColor: "#e2e8f0", padding: 6, borderRadius: 3 },
  label: { fontSize: 6.5, color: "#64748b", textTransform: "uppercase", marginBottom: 2 },
  fields: { flexDirection: "row", flexWrap: "wrap", marginBottom: 10 },
  field: { width: "25%", marginBottom: 5, paddingRight: 4 },
  tableHeader: { flexDirection: "row", paddingVertical: 4, paddingHorizontal: 2, marginBottom: 1 },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0", paddingVertical: 3, paddingHorizontal: 2 },
  // A heading or a note inside the lines (Sales report Phase 2), across the whole table.
  sectionRow: { flexDirection: "row", backgroundColor: "#f1f5f9", borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0", paddingVertical: 4, paddingHorizontal: 2 },
  noteText: { color: "#475569" },
  headerCell: { ...BOLD, fontSize: 7.5, color: "#ffffff" },
  totalsArea: { flexDirection: "row", justifyContent: "space-between", marginTop: 8, gap: 12 },
  words: { flex: 1, paddingTop: 2 },
  totals: { width: "42%" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  totalEmphasis: { ...BOLD, fontSize: 10.5, borderTopWidth: 1, borderTopColor: "#0f172a", paddingTop: 4, marginTop: 2 },
  summary: { marginTop: 10 },
  summaryTitle: { ...BOLD, fontSize: 8, marginBottom: 3 },
  summaryHeader: { flexDirection: "row", borderBottomWidth: 0.75, borderBottomColor: "#94a3b8", paddingBottom: 2 },
  summaryRow: { flexDirection: "row", borderBottomWidth: 0.4, borderBottomColor: "#e2e8f0", paddingVertical: 2 },
  bottom: { flexDirection: "row", justifyContent: "space-between", marginTop: 14, gap: 12 },
  payment: { flexDirection: "row", gap: 8, flex: 1 },
  qr: { width: 74, height: 74 },
  signatory: { width: 180, alignItems: "flex-end" },
  signature: { width: 120, height: 42, objectFit: "contain", marginVertical: 4 },
  signLine: { borderTopWidth: 0.75, borderTopColor: "#0f172a", paddingTop: 3, width: 150, textAlign: "center", fontSize: 7.5 },
  notes: { marginTop: 12 },
  declaration: { marginTop: 8, fontSize: 7, color: "#475569" },
  footer: { position: "absolute", bottom: 18, left: 32, right: 32, fontSize: 6.5, color: "#94a3b8", textAlign: "center" },
});

const text = (value, max = 500) => (value === null || value === undefined ? "" : String(value).slice(0, max));

function cell(column, value, header = false, extra = null) {
  return h(
    Text,
    { key: column.key, style: [{ width: column.width || `${100 / 6}%`, textAlign: column.align || "left", paddingRight: 4 }, header ? styles.headerCell : null, extra] },
    text(value, 300),
  );
}

export function validateDocumentModel(model) {
  if (!model || typeof model !== "object") throw new TypeError("A document model is required.");
  if (!text(model.title)) throw new TypeError("A document needs a title.");
  if (model.table && (!Array.isArray(model.table.columns) || !Array.isArray(model.table.rows))) throw new TypeError("A document table needs columns and rows.");
  if (model.table && model.table.rows.length > 2000) throw new RangeError("A document can hold at most 2000 lines.");
  if (model.summaryTable && (!Array.isArray(model.summaryTable.columns) || !Array.isArray(model.summaryTable.rows))) throw new TypeError("A summary table needs columns and rows.");
  if (model.copies && (!Array.isArray(model.copies) || model.copies.length > 5)) throw new TypeError("Copies are a list of at most 5 names.");
  if (model.brandColor && !HEX.test(model.brandColor)) throw new TypeError("The brand colour is a #RRGGBB value.");
  return model;
}

// A UPI payment QR code (PNG), from a upi://pay link.
export async function upiQrPng(uri) {
  if (!/^upi:\/\/pay\?/i.test(String(uri))) throw new TypeError("A UPI QR needs a upi://pay link.");
  return QRCode.toBuffer(String(uri), { type: "png", errorCorrectionLevel: "M", margin: 1, width: 240 });
}

// The UPI link for a payment to the company: payee address, name, amount and the document as the note.
export function upiPaymentUri({ vpa, payeeName, amount, currency = "INR", note }) {
  const query = new URLSearchParams({ pa: String(vpa), pn: String(payeeName ?? "").slice(0, 60) });
  if (Number(amount) > 0) query.set("am", Number(amount).toFixed(2));
  query.set("cu", currency);
  if (note) query.set("tn", String(note).slice(0, 80));
  return `upi://pay?${query.toString()}`;
}

function pageFor(model, copyName, qr, einvoiceQr = null) {
  const brand = model.brandColor && HEX.test(model.brandColor) ? model.brandColor : "#1e293b";
  const compact = model.layout === "compact";
  const table = model.table;
  const summary = model.summaryTable;
  return h(
    Page,
    { key: copyName ?? "page", size: "A4", style: compact ? styles.compactPage : styles.page },
    h(
      View,
      { style: [styles.header, { borderBottomColor: brand }], fixed: true },
      h(
        View,
        { style: styles.companyBlock },
        model.company?.logo ? h(Image, { style: styles.logo, src: model.company.logo }) : null,
        h(View, null, h(Text, { style: [styles.organization, { color: brand }] }, text(model.organizationName, 200)),
          ...(model.company?.lines ?? []).slice(0, 6).map((line, index) => h(Text, { key: `c${index}`, style: styles.companyLine }, text(line, 200)))),
      ),
      h(
        View,
        null,
        h(Text, { style: styles.title }, text(model.title, 120)),
        model.documentNumber ? h(Text, { style: styles.subtitle }, text(model.documentNumber, 80)) : null,
        model.issuedAt ? h(Text, { style: styles.subtitle }, text(model.issuedAt, 80)) : null,
        model.status ? h(Text, { style: styles.subtitle }, text(model.status, 80)) : null,
        copyName ? h(Text, { style: [styles.copy, { color: brand }] }, text(copyName, 60)) : null,
      ),
    ),
    model.parties?.length
      ? h(View, { style: styles.parties }, ...model.parties.map((party, index) => h(View, { key: `p${index}`, style: styles.party }, h(Text, { style: styles.label }, text(party.label, 60)),
        ...(party.lines || []).map((line, lineIndex) => h(Text, { key: `l${lineIndex}`, style: lineIndex === 0 ? BOLD : null }, text(line, 200))))))
      : null,
    model.fields?.length
      ? h(View, { style: styles.fields }, ...model.fields.map((field, index) => h(View, { key: `f${index}`, style: styles.field }, h(Text, { style: styles.label }, text(field.label, 60)), h(Text, null, text(field.value, 200)))))
      : null,
    // The IRP's signed QR of an e-invoice (Shared Platform plan 7).
    einvoiceQr
      ? h(View, { style: { flexDirection: "row", alignItems: "center", marginBottom: 8 }, wrap: false }, h(Image, { style: styles.qr, src: einvoiceQr }),
          h(Text, { style: { marginLeft: 8, fontSize: 7, color: "#475569" } }, "e-Invoice: signed QR code from the Invoice Registration Portal"))
      : null,
    table
      ? h(
          View,
          null,
          h(View, { style: [styles.tableHeader, { backgroundColor: brand }], fixed: true }, ...table.columns.map((column) => cell(column, column.label, true))),
          ...table.rows.map((row, index) => (row.__section !== undefined || row.__note !== undefined
            ? h(View, { key: `r${index}`, style: row.__section !== undefined ? styles.sectionRow : styles.tableRow, wrap: false },
              h(Text, { style: row.__section !== undefined ? BOLD : styles.noteText }, text(row.__section ?? row.__note, 1000)))
            : h(View, { key: `r${index}`, style: styles.tableRow, wrap: false }, ...table.columns.map((column) => cell(column, row[column.key]))))),
        )
      : null,
    model.totals?.length || model.amountInWords
      ? h(
          View,
          { style: styles.totalsArea, wrap: false },
          h(View, { style: styles.words }, model.amountInWords ? h(View, null, h(Text, { style: styles.label }, "Amount in words"), h(Text, { style: BOLD }, text(model.amountInWords, 300))) : null),
          model.totals?.length
            ? h(View, { style: styles.totals }, ...model.totals.map((total, index) => h(View, { key: `t${index}`, style: [styles.totalRow, total.emphasis ? styles.totalEmphasis : null] }, h(Text, null, text(total.label, 60)), h(Text, null, text(total.value, 60)))))
            : null,
        )
      : null,
    summary
      ? h(
          View,
          { style: styles.summary, wrap: false },
          summary.title ? h(Text, { style: styles.summaryTitle }, text(summary.title, 80)) : null,
          h(View, { style: styles.summaryHeader }, ...summary.columns.map((column) => cell(column, column.label, false, BOLD))),
          ...summary.rows.map((row, index) => h(View, { key: `s${index}`, style: styles.summaryRow }, ...summary.columns.map((column) => cell(column, row[column.key])))),
          summary.totalRow ? h(View, { style: [styles.summaryRow, BOLD] }, ...summary.columns.map((column) => cell(column, summary.totalRow[column.key], false, BOLD))) : null,
        )
      : null,
    model.payment || model.signatory
      ? h(
          View,
          { style: styles.bottom, wrap: false },
          h(
            View,
            { style: styles.payment },
            qr ? h(Image, { style: styles.qr, src: qr }) : null,
            model.payment
              ? h(View, null,
                  model.payment.bankLines?.length ? h(Text, { style: styles.label }, "Bank details") : null,
                  ...(model.payment.bankLines ?? []).slice(0, 6).map((line, index) => h(Text, { key: `b${index}` }, text(line, 120))),
                  model.payment.upi?.label ? h(Text, { style: { marginTop: 3, color: "#475569" } }, text(model.payment.upi.label, 120)) : null)
              : null,
          ),
          model.signatory
            ? h(View, { style: styles.signatory },
                h(Text, { style: BOLD }, `For ${text(model.signatory.companyName, 120)}`),
                model.signatory.image ? h(Image, { style: styles.signature, src: model.signatory.image }) : h(View, { style: { height: 42 } }),
                h(Text, { style: styles.signLine }, text(model.signatory.label ?? "Authorised signatory", 60)))
            : null,
        )
      : null,
    model.notes?.length ? h(View, { style: styles.notes }, ...model.notes.map((note, index) => h(View, { key: `n${index}`, style: { marginBottom: 5 } }, h(Text, { style: styles.label }, text(note.label, 60)), h(Text, null, text(note.text, 4000))))) : null,
    model.declaration ? h(Text, { style: styles.declaration }, text(model.declaration, 800)) : null,
    h(Text, { style: styles.footer, fixed: true, render: ({ pageNumber, totalPages }) => `${text(model.footer, 200)}${model.footer ? " · " : ""}Page ${pageNumber} of ${totalPages}` }),
  );
}

export async function renderDocumentPdf(model) {
  validateDocumentModel(model);
  registerFonts();
  const qr = model.payment?.upi?.uri ? await upiQrPng(model.payment.upi.uri) : null;
  const einvoiceQr = model.einvoiceQr ? await QRCode.toBuffer(String(model.einvoiceQr).slice(0, 4000), { type: "png", errorCorrectionLevel: "L", margin: 1, width: 240 }) : null;
  const copies = model.copies?.length ? model.copies : [null];
  return renderToBuffer(h(Document, { title: text(model.title, 120), author: text(model.organizationName, 120), creator: "Vercentlabs ERP", producer: "Vercentlabs ERP" },
    ...copies.map((copy) => pageFor(model, copy, qr, einvoiceQr))));
}

// ---------------------------------------------------------------- thermal receipts

// A till receipt for a 58 mm or 80 mm thermal printer: one continuous roll page as long as the receipt.
// Model: { width: 58 | 80, logo?, header: [string], title, meta: [string], lines: [{ name, detail?, amount }], totals: [{ label, value, emphasis }],
//          payments?: [string], footer: [string], qr?: { uri } }
export async function renderReceiptPdf(model) {
  registerFonts();
  const width = Number(model?.width) === 58 ? 58 : 80;
  const points = (millimetres) => (millimetres / 25.4) * 72;
  const pageWidth = points(width);
  const lines = Array.isArray(model?.lines) ? model.lines.slice(0, 500) : [];
  const estimatedHeight = points(40) + (lines.length * 2 + (model.header?.length ?? 0) + (model.meta?.length ?? 0) + (model.totals?.length ?? 0) * 1.3 + (model.payments?.length ?? 0) + (model.footer?.length ?? 0)) * 11
    + (model.qr?.uri ? pageWidth * 0.6 : 0) + (model.logo ? 50 : 0);
  const size = width === 58 ? 7 : 8;
  const qr = model.qr?.uri ? await QRCode.toBuffer(String(model.qr.uri), { type: "png", errorCorrectionLevel: "M", margin: 1, width: 200 }) : null;
  const row = (left, right, style = null) => h(View, { style: [{ flexDirection: "row", justifyContent: "space-between" }, style] }, h(Text, { style: { maxWidth: "68%" } }, text(left, 80)), h(Text, null, text(right, 30)));
  const rule = (key) => h(Text, { key, style: { textAlign: "center", color: "#475569" } }, "-".repeat(width === 58 ? 32 : 46));
  const page = h(
    Page,
    { size: [pageWidth, Math.max(points(60), estimatedHeight)], style: { padding: points(3), fontFamily: FAMILY, fontSize: size, color: "#000000" } },
    model.logo ? h(Image, { style: { width: pageWidth * 0.4, height: 40, objectFit: "contain", alignSelf: "center", marginBottom: 4 }, src: model.logo }) : null,
    ...(model.header ?? []).map((line, index) => h(Text, { key: `h${index}`, style: [{ textAlign: "center" }, index === 0 ? { ...BOLD, fontSize: size + 2 } : null] }, text(line, 80))),
    rule("r1"),
    h(Text, { style: { textAlign: "center", ...BOLD } }, text(model.title ?? "Receipt", 60)),
    ...(model.meta ?? []).map((line, index) => h(Text, { key: `m${index}` }, text(line, 80))),
    rule("r2"),
    ...lines.flatMap((line, index) => [
      row(line.name, line.amount, { key: `l${index}` }),
      line.detail ? h(Text, { key: `d${index}`, style: { color: "#334155", marginBottom: 1 } }, text(line.detail, 80)) : null,
    ].filter(Boolean)),
    rule("r3"),
    ...(model.totals ?? []).map((total, index) => row(total.label, total.value, [{ key: `t${index}` }, total.emphasis ? { ...BOLD, fontSize: size + 1.5 } : null])),
    ...(model.payments?.length ? [rule("r4"), ...model.payments.map((line, index) => h(Text, { key: `p${index}` }, text(line, 80)))] : []),
    qr ? h(Image, { style: { width: pageWidth * 0.55, height: pageWidth * 0.55, alignSelf: "center", marginTop: 4 }, src: qr }) : null,
    rule("r5"),
    ...(model.footer ?? []).map((line, index) => h(Text, { key: `f${index}`, style: { textAlign: "center" } }, text(line, 80))),
  );
  return renderToBuffer(h(Document, { title: text(model.title ?? "Receipt", 80), creator: "Vercentlabs ERP", producer: "Vercentlabs ERP" }, page));
}

// A safe download name: letters, digits, dot, dash, underscore; always .pdf.
export function safePdfFileName(base) {
  const cleaned = String(base || "document").normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 100);
  return `${cleaned || "document"}.pdf`;
}
