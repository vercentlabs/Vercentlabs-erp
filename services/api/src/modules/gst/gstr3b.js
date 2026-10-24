// GST — the GSTR-3B working paper of one GSTIN and month: outward liability (3.1, 3.2) from the documents issued (the same ones GSTR-1
// reports), reverse-charge liability and credit, eligible input tax credit (4A) — only credit confirmed claimable, never merely shown on a
// supplier invoice; credit counts in the month its confirmation is booked — reversals (4B), reclaims and ineligible credit (4D), exempt / nil / non-GST inward supplies (5), and the tax payable
// per head before cross-utilisation. Reconciled with GSTR-1, GSTR-2B and the GL; until that is done (or each gap reviewed) it stays
// "Draft GSTR-3B Summary — Reconciliation Required" and can't be approved.
import { createHash } from "node:crypto";

import { GST_PERMISSIONS as P, GstError, HEADS, defaultRegistrationId, monthOf, need, paise, registrationOf, rupees, uuid, ymd } from "./gst-common.js";
import { checkDocument, collectOutward } from "./gst-outward.js";
import { collectAdvances } from "./gst-advances.js";
import { loadReturn, shapeReturn, syncExceptions } from "./gstr1.js";

const DRAFT = "Draft GSTR-3B Summary — Reconciliation Required";
const RECONCILED = "Reconciled working paper — not filed";
export const RECONCILIATION_CODES = ["OUTWARD_BLOCKED", "GSTR1_NOT_PREPARED", "OUTWARD_DIFFERS_FROM_GSTR1", "TWO_B_NOT_IMPORTED", "ITC_NOT_IN_2B", "TWO_B_MISMATCH", "GL_ITC_MISMATCH"];
const z = () => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
const put = (t, l, sign = 1) => { t.taxable += sign * (l.taxable ?? 0); t.igst += sign * (l.igst ?? 0); t.cgst += sign * (l.cgst ?? 0); t.sgst += sign * ((l.sgst ?? 0) + (l.utgst ?? 0)); t.cess += sign * (l.cess ?? 0); return t; };
const R = (t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, rupees(v)]));
const tax = (t) => t.igst + t.cgst + t.sgst + t.cess;

async function build(client, c, registration, period) {
  const { start, end, month } = monthOf(period);
  const isDefault = (await defaultRegistrationId(client, c)) === registration.id;
  const found = [];
  // ---- 3.1 and 3.2: outward
  const outward = await collectOutward(client, c, registration, start, end);
  const t31 = { a: z(), b: z(), c: z(), e: z() };
  const t32 = new Map();
  let blocked = 0;
  for (const d of outward.documents) {
    if (checkDocument(d, registration, outward).some((x) => x.severity === "blocking")) blocked += 1;
    const sign = d.kind === "credit_note" ? -1 : 1;
    for (const l of d.lines) {
      const cls = l.classification;
      put(cls === "taxable" ? t31.a : cls === "zero_rated" ? t31.b : cls === "non_gst" ? t31.e : t31.c, l, sign);
      if (cls === "taxable" && d.nature === "inter" && !d.recipientGstin) {
        const row = t32.get(d.pos) ?? { pos: d.pos, taxable: 0, igst: 0 };
        row.taxable += sign * l.taxable;
        row.igst += sign * l.igst;
        t32.set(d.pos, row);
      }
    }
  }
  // Advances (Sales report Phase 2): 3.1(a) carries the tax on advances received this month (GSTR-1 11A) less what earlier advances
  // used or refunded this month already paid (11B).
  for (const a of await collectAdvances(client, c, registration, start, end)) put(t31.a, a, a.section === "at" ? 1 : -1);
  if (blocked) found.push({ code: "OUTWARD_BLOCKED", severity: "blocking", detail: "outward", message: `${blocked} outward document(s) of this month have blocking problems. See the GSTR-1 for the month and fix them at the source.` });
  // ---- the books' input side for this GSTIN: Finance's tax ledger
  const ledger = (await client.query(`SELECT t.id, t.source_type, t.source_id, t.tax_type, t.direction, t.tax_period, t.taxable_amount, t.tax_amount, t.itc_status, t.reverse_charge, t.supply_category,
        to_char(je.accounting_date, 'YYYY-MM') AS decided_month, b.bill_number, b.buying_registration_id
      FROM tenant.accounting_tax_ledger t LEFT JOIN tenant.accounting_vendor_bills b ON b.id = t.source_id AND t.source_type IN ('vendor_bill', 'vendor_credit_note')
      LEFT JOIN tenant.accounting_journal_entries je ON je.id = t.itc_journal_entry_id
      WHERE t.organization_id = $1 AND t.status <> 'reversed' AND t.direction IN ('input', 'output') AND t.source_type IN ('vendor_bill', 'vendor_credit_note', 'expense')
        AND (CASE WHEN b.buying_registration_id IS NOT NULL THEN b.buying_registration_id = $2 ELSE $3 END)
        AND (t.tax_period = $4 OR to_char(je.accounting_date, 'YYYY-MM') = $4)`, [c.organizationId, registration.id, isDefault, month])).rows;
  const t31d = z();
  const t4 = { a3: z(), a5: z(), b1: z(), b2: z(), d1: z(), d2: z() };
  const t5 = { nil_exempt: 0, non_gst: 0 };
  const pending = z();
  const claimedDocs = new Map();
  const gstHead = (t) => (t === "utgst" ? "sgst" : t);
  for (const r of ledger) {
    const head = gstHead(r.tax_type);
    const gst = ["igst", "cgst", "sgst", "cess"].includes(head);
    const amount = paise(r.tax_amount);
    const inMonth = r.tax_period === month;
    if (r.reverse_charge) {
      if (!gst || !inMonth) continue;
      if (r.direction === "output") t31d[head] += amount; else t4.a3[head] += amount;
      if (r.direction === "output" && (head === "cgst" || head === "igst")) t31d.taxable += paise(r.taxable_amount);
      continue;
    }
    if (r.direction !== "input") continue;
    if (!gst) {
      if (inMonth && !Number(r.tax_amount)) {
        if (r.supply_category === "non_gst") t5.non_gst += paise(r.taxable_amount);
        else if (["exempt", "nil_rated"].includes(r.supply_category)) t5.nil_exempt += paise(r.taxable_amount);
      }
      continue;
    }
    const claimMonth = r.decided_month ?? r.tax_period;
    if (r.itc_status === "ELIGIBLE" && claimMonth === month) {
      t4.a5[head] += amount;
      const doc = claimedDocs.get(r.source_id) ?? { sourceType: r.source_type, number: r.bill_number, tax: 0 };
      doc.tax += amount;
      claimedDocs.set(r.source_id, doc);
    } else if (r.itc_status === "INELIGIBLE" && claimMonth === month) t4.d2[head] += amount;
    else if (r.itc_status === "PENDING" && inMonth) pending[head] += amount;
  }
  const adjustments = (await client.query(`SELECT * FROM tenant.gst_itc_adjustments WHERE organization_id = $1 AND registration_id = $2 AND period = $3`, [c.organizationId, registration.id, start])).rows;
  for (const a of adjustments) put(a.kind === "reclaim" ? t4.d1 : a.reclaimable ? t4.b2 : t4.b1, { igst: paise(a.igst), cgst: paise(a.cgst), sgst: paise(a.sgst), cess: paise(a.cess) });
  const net = z();
  for (const h of ["igst", "cgst", "sgst", "cess"]) net[h] = t4.a3[h] + t4.a5[h] + t4.d1[h] - t4.b1[h] - t4.b2[h];
  const liability = z();
  for (const h of ["igst", "cgst", "sgst", "cess"]) liability[h] = t31.a[h] + t31.b[h];
  const payable = z();
  for (const h of ["igst", "cgst", "sgst", "cess"]) payable[h] = liability[h] - net[h];
  if (tax(pending)) found.push({ code: "ITC_PENDING", severity: "warning", detail: "pending", message: `₹${rupees(tax(pending))} of input GST on this month's supplier invoices is awaiting confirmation and is not claimed here.` });
  if (tax(t31d)) found.push({ code: "RCM_CASH", severity: "warning", detail: "rcm", message: `₹${rupees(tax(t31d))} of reverse-charge tax is due: it is paid in cash, not set off against credit.` });

  // ---- with GSTR-1 of the month
  const g1 = (await client.query(`SELECT status, summary FROM tenant.gst_returns WHERE organization_id = $1 AND return_type = 'GSTR1' AND registration_id = $2 AND period = $3`, [c.organizationId, registration.id, start])).rows[0];
  let gstr1 = null;
  if (!g1 || g1.status === "DRAFT") found.push({ code: "GSTR1_NOT_PREPARED", severity: "warning", detail: "gstr1", message: "The GSTR-1 of this month is not prepared, so the outward tax is not compared with it." });
  else {
    const s = g1.summary?.liability ?? {};
    const advance = g1.summary?.advanceTax ?? {};
    const diff = ["igst", "cgst", "cess"].map((h) => [h, paise(s[h]) + paise(advance[h]) - liability[h]])
      .concat([["sgst", paise(s.sgst) + paise(s.utgst) + paise(advance.sgst) + paise(advance.utgst) - liability.sgst]]);
    gstr1 = { status: g1.status, differences: Object.fromEntries(diff.map(([h, v]) => [h, rupees(v)])) };
    if (diff.some(([, v]) => Math.abs(v) > 100)) found.push({ code: "OUTWARD_DIFFERS_FROM_GSTR1", severity: "warning", detail: "gstr1", message: `The outward tax differs from the ${g1.status.toLowerCase()} GSTR-1 of this month. Prepare the GSTR-1 again or explain the difference.` });
  }
  // ---- with GSTR-2B of the month
  const imp = (await client.query(`SELECT id FROM tenant.gst_2b_imports WHERE organization_id = $1 AND registration_id = $2 AND period = $3 AND status = 'current'`, [c.organizationId, registration.id, start])).rows[0];
  let twoB = null;
  if (!imp) found.push({ code: "TWO_B_NOT_IMPORTED", severity: "warning", detail: "2b", message: "GSTR-2B for this month is not imported, so claimed credit is not checked against what suppliers reported." });
  else {
    const lines = (await client.query(`SELECT match_status, matched_source_id, document_number, supplier_gstin, itc_available, igst + cgst + sgst + cess AS t FROM tenant.gst_2b_lines WHERE import_id = $1`, [imp.id])).rows;
    const matched = new Set(lines.filter((l) => l.matched_source_id).map((l) => l.matched_source_id));
    for (const [id, d] of claimedDocs) if (!matched.has(id)) found.push({ code: "ITC_NOT_IN_2B", severity: "warning", sourceType: d.sourceType, sourceId: id, documentNumber: d.number,
      message: `Credit of ₹${rupees(d.tax)} is claimed on ${d.number ?? "this document"}, which this month's GSTR-2B does not show.` });
    for (const l of lines.filter((x) => x.match_status === "mismatch")) found.push({ code: "TWO_B_MISMATCH", severity: "warning", sourceId: l.matched_source_id, documentNumber: l.document_number,
      message: `The supplier (${l.supplier_gstin}) reported different amounts for ${l.document_number} in GSTR-2B.` });
    const available = lines.filter((l) => l.itc_available).reduce((s, l) => s + paise(l.t), 0);
    twoB = { importId: imp.id, lines: lines.length, matched: lines.filter((l) => l.match_status === "matched").length, mismatch: lines.filter((l) => l.match_status === "mismatch").length,
      notInBooks: lines.filter((l) => l.match_status === "not_in_books").length, availableItc: rupees(available) };
  }
  // ---- with the GL's input-tax accounts (one GSTIN only)
  const registrations = Number((await client.query(`SELECT count(*) AS n FROM tenant.tax_registrations WHERE organization_id = $1 AND status = 'active'`, [c.organizationId])).rows[0].n);
  let gl = null;
  if (registrations === 1) {
    gl = z();
    for (const r of (await client.query(`SELECT m.mapping_key, sum(l.base_debit_amount - l.base_credit_amount) AS t FROM tenant.accounting_journal_lines l
        JOIN tenant.accounting_journal_entries e ON e.id = l.journal_entry_id
        JOIN tenant.accounting_account_mappings m ON m.account_id = l.account_id AND m.organization_id = l.organization_id AND m.status = 'active' AND m.mapping_key IN ('input_igst', 'input_cgst', 'input_sgst', 'input_cess')
        WHERE l.organization_id = $1 AND e.status = 'posted' AND e.accounting_date BETWEEN $2 AND $3 GROUP BY m.mapping_key`, [c.organizationId, start, end])).rows) gl[r.mapping_key.slice(6)] += paise(r.t);
    if (Math.abs(tax(gl) - tax(net)) > 100) found.push({ code: "GL_ITC_MISMATCH", severity: "warning", detail: "gl",
      message: `The input-tax accounts moved ₹${rupees(tax(gl))} in the month, against net credit of ₹${rupees(tax(net))} here.` });
  }
  const summary = {
    table31: { a: R(t31.a), b: R(t31.b), c: R(t31.c), d: R(t31d), e: R(t31.e) }, table32: [...t32.values()].map((r) => ({ pos: r.pos, taxable: rupees(r.taxable), igst: rupees(r.igst) })),
    table4: { a3: R(t4.a3), a5: R(t4.a5), b1: R(t4.b1), b2: R(t4.b2), d1: R(t4.d1), d2: R(t4.d2), net: R(net) }, table5: { nilExempt: rupees(t5.nil_exempt), nonGst: rupees(t5.non_gst) },
    liability: R(liability), payable: R(payable), rcmCash: R(t31d), pending: R(pending), gstr1, twoB,
    gl: gl ? R(gl) : null, glNote: gl ? null : `${registrations} registrations share the input-tax accounts, so the GL is compared on the company summary only.`,
    notes: ["Tax payable is per head before cross-utilisation of IGST / CGST / SGST credit; the set-off is done on the portal.", "Interest and late fee (Table 5.1) are not worked out here."],
  };
  const hash = createHash("sha256").update(JSON.stringify([outward.documents.map((d) => [d.sourceId, d.hash]).sort(), ledger.map((r) => [r.id, r.itc_status, r.tax_amount]).sort(),
    adjustments.map((a) => a.id).sort(), imp?.id ?? null])).digest("hex").slice(0, 40);
  return { summary, found, hash };
}

async function labelOf(client, returnId) {
  const open = (await client.query(`SELECT count(*)::int AS n FROM tenant.gst_exceptions WHERE return_id = $1 AND status = 'open' AND code = ANY($2::text[])`, [returnId, RECONCILIATION_CODES])).rows[0].n;
  return open ? DRAFT : RECONCILED;
}
export async function refreshGstr3bLabel(client, returnId) {
  const r = (await client.query(`SELECT status, return_type FROM tenant.gst_returns WHERE id = $1`, [returnId])).rows[0];
  if (r?.return_type !== "GSTR3B" || !["DRAFT", "PREPARED"].includes(r.status)) return;
  await client.query(`UPDATE tenant.gst_returns SET label = $2, updated_at = now() WHERE id = $1`, [returnId, await labelOf(client, returnId)]);
}

export async function prepareGstr3b(client, c, input = {}) {
  need(c, P.prepare, "You do not have permission to prepare GST returns.");
  const registration = await registrationOf(client, c, input.registrationId);
  const { start } = monthOf(input.period);
  let row = (await client.query(`SELECT * FROM tenant.gst_returns WHERE organization_id = $1 AND return_type = 'GSTR3B' AND registration_id = $2 AND period = $3 FOR UPDATE`, [c.organizationId, registration.id, start])).rows[0];
  if (!row) row = (await client.query(`INSERT INTO tenant.gst_returns (organization_id, return_type, registration_id, gstin, period, created_by) VALUES ($1, 'GSTR3B', $2, $3, $4, $5) RETURNING *`,
    [c.organizationId, registration.id, registration.registration_number, start, c.userId ?? null])).rows[0];
  if (["APPROVED", "FILED"].includes(row.status)) throw new GstError(409, `This GSTR-3B is ${row.status.toLowerCase()}; ${row.status === "APPROVED" ? "reopen it to prepare it again" : "a filed return is not changed"}.`, "GST_RETURN_LOCKED");
  const { summary, found, hash } = await build(client, c, registration, input.period);
  const open = await syncExceptions(client, c, row.id, found);
  summary.exceptions = open;
  const updated = (await client.query(`UPDATE tenant.gst_returns SET status = 'PREPARED', summary = $2::jsonb, reconciliation = $3::jsonb, label = $4, content_hash = $5, prepared_by = $6, prepared_at = now(),
      version = version + 1, updated_at = now() WHERE id = $1 RETURNING *`,
    [row.id, JSON.stringify(summary), JSON.stringify({ gstr1: summary.gstr1, twoB: summary.twoB, gl: summary.gl }), await labelOf(client, row.id), hash, c.userId ?? null])).rows[0];
  return shapeReturn(updated);
}

// For approval: the 3B may be approved only once reconciled (or each gap reviewed), and only if nothing changed since it was prepared.
export async function assertGstr3bApprovable(client, c, r) {
  if ((await labelOf(client, r.id)) !== RECONCILED) throw new GstError(409, "Reconcile first: GSTR-1, GSTR-2B and the GL gaps must be resolved or each accepted with a reason.", "GST_RETURN_NOT_RECONCILED");
  const registration = await registrationOf(client, c, r.registration_id);
  const { hash } = await build(client, c, registration, ymd(r.period));
  if (hash !== r.content_hash) throw new GstError(409, "Documents, credit or GSTR-2B changed after the GSTR-3B was prepared. Prepare it again, then approve.", "GST_RETURN_STALE");
}

export async function exportGstr3b(client, c, id) {
  need(c, P.view, "You do not have permission to export GST returns.");
  const r = await loadReturn(client, c, uuid(id, "Return"));
  if (r.return_type !== "GSTR3B") throw new GstError(400, "That is not a GSTR-3B.", "GST_INVALID");
  const s = r.summary;
  const row = (label, t) => [label, t?.taxable ?? "", t?.igst ?? 0, t?.cgst ?? 0, t?.sgst ?? 0, t?.cess ?? 0];
  const lines = [
    row("3.1(a) Outward taxable supplies (other than zero-rated, nil-rated and exempt)", s.table31?.a), row("3.1(b) Outward taxable supplies (zero-rated)", s.table31?.b),
    row("3.1(c) Other outward supplies (nil-rated, exempt)", s.table31?.c), row("3.1(d) Inward supplies (liable to reverse charge)", s.table31?.d), row("3.1(e) Non-GST outward supplies", s.table31?.e),
    row("4(A)(3) ITC: inward supplies liable to reverse charge", s.table4?.a3), row("4(A)(5) ITC: all other", s.table4?.a5), row("4(B)(1) ITC reversed: Rules 38, 42, 43, s.17(5)", s.table4?.b1),
    row("4(B)(2) ITC reversed: others", s.table4?.b2), row("4(C) Net ITC available", s.table4?.net), row("4(D)(1) ITC reclaimed", s.table4?.d1), row("4(D)(2) Ineligible ITC", s.table4?.d2),
    row("Tax payable before cross-utilisation", s.payable), row("Reverse-charge tax payable in cash", s.rcmCash),
    ...(s.table32 ?? []).map((x) => [`3.2 Inter-state to unregistered persons · place of supply ${x.pos ?? "?"}`, x.taxable, x.igst, "", "", ""]),
    ["5 Exempt / nil-rated inward supplies", s.table5?.nilExempt ?? 0, "", "", "", ""], ["5 Non-GST inward supplies", s.table5?.nonGst ?? 0, "", "", "", ""],
  ];
  const cell = (v) => { const x = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  return { fileName: `gstr3b-working-${r.gstin}-${ymd(r.period).slice(0, 7)}.csv`, mimeType: "text/csv",
    body: [[`${r.label ?? DRAFT}`], ["Table", "Taxable value", "IGST", "CGST", "SGST/UTGST", "Cess"], ...lines].map((l) => l.map(cell).join(",")).join("\n") };
}
