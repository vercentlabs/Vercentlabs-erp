// GST — GSTR-2B: the supplier-reported invoices of one GSTIN and month, imported from the portal's download (CSV), matched with the supplier
// invoices and expenses in the books by supplier GSTIN and invoice number, amounts compared head by head. Matched lines can confirm the
// input tax credit waiting on those documents; what is in the books but not in 2B (and the other way round) is shown, never assumed.
import { decideInputTaxCredit } from "../accounting/input-tax-credit.js";
import { validateGstin } from "../../core/invoicing/index.js";
import { GST_PERMISSIONS as P, GstError, can, defaultRegistrationId, monthOf, need, paise, registrationOf, rupees, text, uuid, ymd } from "./gst-common.js";

export const documentKey = (n) => String(n ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, "");
const norm = (h) => String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
// The portal's GSTR-2B (B2B) columns, and the plain names a person might use.
const COLUMNS = {
  gstin: ["gstinofsupplier", "suppliergstin", "gstin"], name: ["tradelegalname", "tradename", "legalname", "suppliername", "name"],
  number: ["invoicenumber", "notenumber", "documentnumber", "invoiceno", "number"], type: ["invoicetype", "notetype", "documenttype", "type"],
  date: ["invoicedate", "notedate", "documentdate", "date"], pos: ["placeofsupply", "pos"], rc: ["supplyattractreversecharge", "reversecharge"],
  taxable: ["taxablevalue", "taxable"], igst: ["integratedtax", "igst"], cgst: ["centraltax", "cgst"], sgst: ["stateuttax", "statetax", "sgst", "utgst"], cess: ["cess"],
  itc: ["itcavailability", "itcavailable", "itc"],
};
function parseCsv(body) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const s = String(body ?? "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && s[i + 1] === "\n") i += 1; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim()));
}
function dateOf(v) {
  const s = String(v ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  m = /^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})$/.exec(s);
  if (m && months[m[2].toLowerCase()]) return `${m[3]}-${months[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  return null;
}
const amount = (v) => { const n = Number(String(v ?? "").replace(/[,₹\s]/g, "")); return Number.isFinite(n) ? n : 0; };

// The books' side: supplier invoices (and notes) and expenses of this GSTIN with input GST, by supplier GSTIN + invoice number.
async function bookDocuments(client, c, registration, keys = null) {
  const isDefault = (await defaultRegistrationId(client, c)) === registration.id;
  const docs = (await client.query(`SELECT 'vendor_bill' AS source_type, b.id, b.bill_number AS number, b.bill_type AS kind, COALESCE(b.supplier_invoice_number, b.supplier_invoice_reference) AS supplier_number,
        upper(COALESCE(b.supplier_tax_snapshot->>'gstin', b.supplier_snapshot->>'gstin', '')) AS gstin, b.bill_date AS date, b.taxable_total, b.subtotal - b.discount_total AS net
      FROM tenant.accounting_vendor_bills b WHERE b.organization_id = $1 AND b.posted_at IS NOT NULL AND b.status NOT IN ('cancelled', 'reversed')
        AND (b.buying_registration_id = $2 OR (b.buying_registration_id IS NULL AND $3))
    UNION ALL SELECT 'expense', e.id, e.expense_number, 'bill', e.supplier_invoice_reference, upper(COALESCE(e.supplier_gstin, '')), e.expense_date, e.amount, e.amount
      FROM tenant.accounting_expenses e WHERE e.organization_id = $1 AND e.posted_at IS NOT NULL AND e.status NOT IN ('cancelled', 'reversed') AND e.supplier_gstin IS NOT NULL AND $3`,
    [c.organizationId, registration.id, isDefault])).rows;
  const ids = docs.map((d) => d.id);
  const tax = new Map();
  if (ids.length) {
    for (const r of (await client.query(`SELECT source_id, tax_type, sum(tax_amount) AS t, array_agg(DISTINCT itc_status) AS statuses, min(tax_period) AS period FROM tenant.accounting_tax_ledger
        WHERE organization_id = $1 AND direction = 'input' AND status <> 'reversed' AND NOT reverse_charge AND source_id = ANY($2::uuid[]) GROUP BY source_id, tax_type`, [c.organizationId, ids])).rows) {
      const t = tax.get(r.source_id) ?? { igst: 0, cgst: 0, sgst: 0, cess: 0, statuses: new Set(), period: r.period };
      const head = r.tax_type === "utgst" ? "sgst" : r.tax_type;
      if (head in t) t[head] += paise(r.t);
      for (const s of r.statuses) t.statuses.add(s);
      tax.set(r.source_id, t);
    }
  }
  return docs.map((d) => ({ ...d, key: documentKey(d.supplier_number), tax: tax.get(d.id) ?? { igst: 0, cgst: 0, sgst: 0, cess: 0, statuses: new Set(), period: null } }))
    .filter((d) => !keys || keys.has(`${d.gstin}|${d.key}`));
}

export async function importGstr2b(client, c, input = {}) {
  need(c, P.itc, "You do not have permission to import GSTR-2B.");
  const registration = await registrationOf(client, c, input.registrationId);
  const { start } = monthOf(input.period);
  const rows = parseCsv(input.csv);
  if (rows.length < 2) throw new GstError(400, "The file has no rows. Download GSTR-2B (B2B) from the portal as CSV and upload it.", "GST_2B_EMPTY");
  if (rows.length > 20001) throw new GstError(400, "Up to 20,000 rows can be imported at once.", "GST_2B_TOO_LARGE");
  const header = rows[0].map(norm);
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, names]) => [k, header.findIndex((h) => names.includes(h))]));
  if (col.gstin < 0 || col.number < 0 || col.taxable < 0) throw new GstError(400, "The file needs the supplier GSTIN, invoice number and taxable value columns.", "GST_2B_COLUMNS");
  const at = (r, k) => (col[k] >= 0 ? r[col[k]] : undefined);
  const skipped = [];
  const lines = [];
  for (const [i, r] of rows.slice(1).entries()) {
    const gstin = String(at(r, "gstin") ?? "").trim().toUpperCase();
    const number = text(at(r, "number"), 40);
    if (!validateGstin(gstin).valid) { skipped.push({ row: i + 2, reason: `GSTIN ${gstin || "(blank)"} is not valid` }); continue; }
    if (!number) { skipped.push({ row: i + 2, reason: "No invoice number" }); continue; }
    const type = norm(at(r, "type"));
    lines.push({ gstin, name: text(at(r, "name"), 200) || null, number, key: documentKey(number), date: dateOf(at(r, "date")), pos: text(at(r, "pos"), 60) || null,
      kind: type.includes("credit") || type === "c" ? "credit_note" : type.includes("debit") || type === "d" ? "debit_note" : "invoice",
      rc: /^y/i.test(String(at(r, "rc") ?? "")), taxable: amount(at(r, "taxable")), igst: amount(at(r, "igst")), cgst: amount(at(r, "cgst")), sgst: amount(at(r, "sgst")), cess: amount(at(r, "cess")),
      itc: col.itc < 0 ? true : !/^n/i.test(String(at(r, "itc") ?? "Y").trim()) });
  }
  await client.query(`UPDATE tenant.gst_2b_imports SET status = 'superseded' WHERE organization_id = $1 AND registration_id = $2 AND period = $3 AND status = 'current'`, [c.organizationId, registration.id, start]);
  const imp = (await client.query(`INSERT INTO tenant.gst_2b_imports (organization_id, registration_id, period, file_name, row_count, skipped, imported_by) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *`,
    [c.organizationId, registration.id, start, text(input.fileName, 200) || null, lines.length, JSON.stringify(skipped.slice(0, 200)), c.userId ?? null])).rows[0];
  for (const l of lines) {
    await client.query(`INSERT INTO tenant.gst_2b_lines (organization_id, import_id, supplier_gstin, supplier_name, document_type, document_number, document_key, document_date, place_of_supply, reverse_charge,
        taxable, igst, cgst, sgst, cess, itc_available) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [c.organizationId, imp.id, l.gstin, l.name, l.kind, l.number, l.key, l.date, l.pos, l.rc, l.taxable, l.igst, l.cgst, l.sgst, l.cess, l.itc]);
  }
  await matchGstr2b(client, c, imp.id);
  return get2bReconciliation(client, c, { registrationId: registration.id, period: input.period });
}

// Each line: matched (same supplier GSTIN + invoice number, every head within ₹1), mismatch (found, amounts differ), or not in the books.
export async function matchGstr2b(client, c, importId) {
  const imp = (await client.query(`SELECT * FROM tenant.gst_2b_imports WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(importId, "Import")])).rows[0];
  if (!imp) throw new GstError(404, "That GSTR-2B import was not found.", "GST_2B_NOT_FOUND");
  const registration = await registrationOf(client, c, imp.registration_id);
  const lines = (await client.query(`SELECT * FROM tenant.gst_2b_lines WHERE import_id = $1 ORDER BY supplier_gstin, document_key`, [imp.id])).rows;
  const books = await bookDocuments(client, c, registration, new Set(lines.map((l) => `${l.supplier_gstin}|${l.document_key}`)));
  const byKey = new Map(books.map((b) => [`${b.gstin}|${b.key}`, b]));
  const used = new Set();
  for (const l of lines) {
    const b = byKey.get(`${l.supplier_gstin}|${l.document_key}`);
    if (!b || used.has(b.id)) {
      await client.query(`UPDATE tenant.gst_2b_lines SET match_status = 'not_in_books', matched_source_type = NULL, matched_source_id = NULL, difference = NULL WHERE id = $1`, [l.id]);
      continue;
    }
    used.add(b.id);
    // notes are negative in the books and positive in 2B: compare sizes, head by head
    const ours = { taxable: paise(b.taxable_total ?? b.net), igst: b.tax.igst, cgst: b.tax.cgst, sgst: b.tax.sgst, cess: b.tax.cess };
    const theirs = { taxable: paise(l.taxable), igst: paise(l.igst), cgst: paise(l.cgst), sgst: paise(l.sgst), cess: paise(l.cess) };
    const difference = Object.fromEntries(Object.keys(ours).map((k) => [k, rupees(Math.abs(theirs[k]) - Math.abs(ours[k]))]).filter(([, v]) => Math.abs(v) > 1));
    await client.query(`UPDATE tenant.gst_2b_lines SET match_status = $2, matched_source_type = $3, matched_source_id = $4, difference = $5::jsonb WHERE id = $1`,
      [l.id, Object.keys(difference).length ? "mismatch" : "matched", b.source_type, b.id, Object.keys(difference).length ? JSON.stringify(difference) : null]);
  }
  return imp;
}

// The month's GSTR-2B against the books: the import, its lines by match, and the documents with input GST in the books that 2B doesn't show.
export async function get2bReconciliation(client, c, input = {}) {
  need(c, P.view, "You do not have permission to see GST reconciliations.");
  const registration = await registrationOf(client, c, input.registrationId);
  const { start, month } = monthOf(input.period);
  const imp = (await client.query(`SELECT i.*, u.full_name AS imported_by_name FROM tenant.gst_2b_imports i LEFT JOIN public.users u ON u.id = i.imported_by
    WHERE i.organization_id = $1 AND i.registration_id = $2 AND i.period = $3 AND i.status = 'current'`, [c.organizationId, registration.id, start])).rows[0] ?? null;
  const lines = imp ? (await client.query(`SELECT l.*, COALESCE(b.bill_number, e.expense_number) AS book_number FROM tenant.gst_2b_lines l
      LEFT JOIN tenant.accounting_vendor_bills b ON b.id = l.matched_source_id AND l.matched_source_type = 'vendor_bill' LEFT JOIN tenant.accounting_expenses e ON e.id = l.matched_source_id AND l.matched_source_type = 'expense'
      WHERE l.import_id = $1 ORDER BY (l.match_status = 'matched'), l.supplier_gstin, l.document_number`, [imp.id])).rows : [];
  const matched = new Set(imp ? (await client.query(`SELECT DISTINCT l.matched_source_id FROM tenant.gst_2b_lines l JOIN tenant.gst_2b_imports i ON i.id = l.import_id
      WHERE i.organization_id = $1 AND i.registration_id = $2 AND i.status = 'current' AND l.matched_source_id IS NOT NULL`, [c.organizationId, registration.id])).rows.map((r) => r.matched_source_id) : []);
  const books = (await bookDocuments(client, c, registration)).filter((b) => b.tax.period === month && (b.tax.igst + b.tax.cgst + b.tax.sgst + b.tax.cess) !== 0);
  const notIn2b = books.filter((b) => !matched.has(b.id)).map((b) => ({ sourceType: b.source_type, sourceId: b.id, number: b.number, supplierNumber: b.supplier_number, gstin: b.gstin || null,
    date: ymd(b.date), tax: rupees(b.tax.igst + b.tax.cgst + b.tax.sgst + b.tax.cess), itcStatus: [...b.tax.statuses].join(", ") }));
  const count = (s) => lines.filter((l) => l.match_status === s).length;
  return { gstin: registration.registration_number, period: month, imported: imp ? { id: imp.id, fileName: imp.file_name, rows: imp.row_count, skipped: imp.skipped, importedAt: imp.imported_at, importedBy: imp.imported_by_name } : null,
    counts: { matched: count("matched"), mismatch: count("mismatch"), notInBooks: count("not_in_books"), notIn2b: notIn2b.length }, lines, notIn2b,
    canImport: can(c, P.itc) };
}

// For every matched line the portal shows as available, the credit waiting on that document is confirmed (one Finance journal each).
export async function confirmMatchedCredit(client, c, input = {}) {
  need(c, P.itc, "You do not have permission to confirm input tax credit.");
  const registration = await registrationOf(client, c, input.registrationId);
  const { start, end, month } = monthOf(input.period);
  // booked in the 2B month (its last day, or today while the month is still running), so the credit counts in that month's GSTR-3B
  const today = ymd(new Date());
  const date = input.date || (today < end ? today : end);
  const lines = (await client.query(`SELECT DISTINCT l.matched_source_type, l.matched_source_id FROM tenant.gst_2b_lines l JOIN tenant.gst_2b_imports i ON i.id = l.import_id
      WHERE i.organization_id = $1 AND i.registration_id = $2 AND i.period = $3 AND i.status = 'current' AND l.match_status = 'matched' AND l.itc_available`, [c.organizationId, registration.id, start])).rows;
  const elevated = { ...c, permissions: [...new Set([...(c.permissions ?? []), "accounting.tax.manage"])] };
  let confirmed = 0;
  for (const l of lines) {
    const pending = (await client.query(`SELECT 1 FROM tenant.accounting_tax_ledger WHERE organization_id = $1 AND source_id = $2 AND direction = 'input' AND itc_status = 'PENDING' AND status <> 'reversed' LIMIT 1`,
      [c.organizationId, l.matched_source_id])).rows.length;
    if (!pending) continue;
    const sourceType = l.matched_source_type === "vendor_bill"
      ? ((await client.query(`SELECT bill_type FROM tenant.accounting_vendor_bills WHERE id = $1`, [l.matched_source_id])).rows[0]?.bill_type === "credit_note" ? "vendor_credit_note" : "vendor_bill") : "expense";
    await decideInputTaxCredit(client, elevated, { sourceType, sourceId: l.matched_source_id, decision: "ELIGIBLE", reason: `Matched in GSTR-2B for ${month}`, reference: `GSTR-2B ${month}`, date });
    confirmed += 1;
  }
  return { confirmed };
}
