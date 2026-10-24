// GST — the GSTR-1 working paper of one company registration (GSTIN) and month: select GSTIN + period → collect what was issued and posted →
// validate every document → reconcile with Finance's tax ledger and the GL → review the exceptions → approve (someone other than the
// preparer) → export the working data → record the filing (the portal's reference). It prepares return data; it does not file anything,
// and its CSV is working data, not the portal's offline-tool file.
import { createHash } from "node:crypto";

import {
  GST_PERMISSIONS as P, GstError, HEADS, addInto, asRupees, can, monthOf, need, paise, registrationOf, rupees, text, uuid, ymd, zero,
} from "./gst-common.js";
import { checkDocument, collectOutward, sectionOf } from "./gst-outward.js";
import { collectAdvances } from "./gst-advances.js";

export const GSTR1_SECTIONS = Object.freeze({
  b2b: "B2B invoices (4A, 4B, 6B, 6C)", b2cl: "B2C large invoices (5)", b2cs: "B2C small (7)", cdnr: "Credit / debit notes — registered (9B)",
  cdnur: "Credit / debit notes — unregistered (9B)", exp: "Exports (6A)", nil: "Nil-rated, exempt and non-GST (8)", hsn: "HSN / SAC summary (12)", docs: "Documents issued (13)",
  at: "Advances received, not yet invoiced (11A)", atadj: "Advances adjusted or refunded (11B)",
});
const LIABLE = ["b2b", "b2cl", "b2cs", "cdnr", "cdnur", "exp"];
const sha = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 40);
const setHash = (documents, cancelled) => sha([documents.map((d) => [d.sourceId, d.hash]).sort(), cancelled.map((x) => x.number).sort()]);

async function returnFor(client, c, { registrationId, period, returnType = "GSTR1", lock = false, create = false }) {
  const registration = await registrationOf(client, c, registrationId);
  const { start } = monthOf(period);
  let row = (await client.query(`SELECT * FROM tenant.gst_returns WHERE organization_id = $1 AND return_type = $2 AND registration_id = $3 AND period = $4${lock ? " FOR UPDATE" : ""}`,
    [c.organizationId, returnType, registration.id, start])).rows[0];
  if (!row && create) {
    row = (await client.query(`INSERT INTO tenant.gst_returns (organization_id, return_type, registration_id, gstin, period, created_by) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (organization_id, return_type, registration_id, period) DO UPDATE SET updated_at = tenant.gst_returns.updated_at RETURNING *`,
      [c.organizationId, returnType, registration.id, registration.registration_number, start, c.userId ?? null])).rows[0];
  }
  return { registration, row };
}
export async function loadReturn(client, c, id, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.gst_returns WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, uuid(id, "Return")])).rows[0];
  if (!row) throw new GstError(404, "That return was not found.", "GST_RETURN_NOT_FOUND");
  return row;
}

// Exceptions found now replace the open ones; a warning waived before stays waived while it still applies; what no longer applies is resolved.
export async function syncExceptions(client, c, returnId, found) {
  const existing = new Map((await client.query(`SELECT key, status FROM tenant.gst_exceptions WHERE return_id = $1`, [returnId])).rows.map((r) => [r.key, r.status]));
  const keys = new Set();
  for (const x of found) {
    const key = `${x.code}|${x.sourceId ?? ""}|${x.detail ?? x.message}`.slice(0, 400);
    if (keys.has(key)) continue;
    keys.add(key);
    const before = existing.get(key);
    if (before === undefined) {
      await client.query(`INSERT INTO tenant.gst_exceptions (organization_id, return_id, key, code, severity, source_type, source_id, document_number, message) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [c.organizationId, returnId, key, x.code, x.severity, x.sourceType ?? null, x.sourceId ?? null, x.documentNumber ?? null, x.message]);
    } else if (before === "resolved" || (before === "waived" && x.severity === "blocking")) {
      await client.query(`UPDATE tenant.gst_exceptions SET status = 'open', severity = $3, message = $4, note = NULL, decided_by = NULL, decided_at = NULL, updated_at = now() WHERE return_id = $1 AND key = $2`,
        [returnId, key, x.severity, x.message]);
    } else {
      await client.query(`UPDATE tenant.gst_exceptions SET severity = $3, message = $4, updated_at = now() WHERE return_id = $1 AND key = $2`, [returnId, key, x.severity, x.message]);
    }
  }
  for (const [key, status] of existing) {
    if (!keys.has(key) && status !== "resolved") await client.query(`UPDATE tenant.gst_exceptions SET status = 'resolved', updated_at = now() WHERE return_id = $1 AND key = $2`, [returnId, key]);
  }
  return (await client.query(`SELECT severity, count(*)::int AS n FROM tenant.gst_exceptions WHERE return_id = $1 AND status = 'open' GROUP BY severity`, [returnId])).rows
    .reduce((acc, r) => ({ ...acc, [r.severity]: r.n }), { blocking: 0, warning: 0 });
}

// The output tax of the reported documents against Finance's tax ledger (what was posted for the same documents), and against the GL's
// output-tax accounts for the month (only meaningful when one registration uses those accounts).
async function reconcileOutward(client, c, registration, start, end, documents, returnTotals) {
  const financeIds = documents.filter((d) => d.sourceType === "customer_invoice").map((d) => d.sourceId);
  const fromFinance = documents.filter((d) => d.sourceType === "customer_invoice").reduce((t, d) => {
    const sign = d.kind === "credit_note" ? -1 : 1;
    for (const l of d.lines) for (const k of HEADS) t[k] += sign * l[k];
    return t;
  }, { igst: 0, cgst: 0, sgst: 0, utgst: 0, cess: 0 });
  const ledger = { igst: 0, cgst: 0, sgst: 0, utgst: 0, cess: 0, other: 0 };
  if (financeIds.length) {
    for (const r of (await client.query(`SELECT tax_type, sum(tax_amount) AS t FROM tenant.accounting_tax_ledger WHERE organization_id = $1 AND direction = 'output' AND status <> 'reversed'
        AND source_id = ANY($2::uuid[]) GROUP BY tax_type`, [c.organizationId, financeIds])).rows) ledger[HEADS.includes(r.tax_type) ? r.tax_type : "other"] += paise(r.t);
  }
  const sum = (o) => HEADS.reduce((s, k) => s + (o[k] ?? 0), 0) + (o.other ?? 0);
  const registrations = Number((await client.query(`SELECT count(*) AS n FROM tenant.tax_registrations WHERE organization_id = $1 AND status = 'active'`, [c.organizationId])).rows[0].n);
  let gl = null;
  if (registrations === 1) {
    gl = { igst: 0, cgst: 0, sgst: 0, cess: 0 };
    for (const r of (await client.query(`SELECT m.mapping_key, sum(l.base_credit_amount - l.base_debit_amount) AS t FROM tenant.accounting_journal_lines l
        JOIN tenant.accounting_journal_entries e ON e.id = l.journal_entry_id
        JOIN tenant.accounting_account_mappings m ON m.account_id = l.account_id AND m.organization_id = l.organization_id AND m.status = 'active'
          AND m.mapping_key IN ('output_igst', 'output_cgst', 'output_sgst', 'output_cess')
        WHERE l.organization_id = $1 AND e.status = 'posted' AND e.accounting_date BETWEEN $2 AND $3 GROUP BY m.mapping_key`, [c.organizationId, start, end])).rows) gl[r.mapping_key.slice(7)] += paise(r.t);
  }
  const reportedTax = HEADS.reduce((s, k) => s + returnTotals[k], 0);
  const glTax = gl ? gl.igst + gl.cgst + gl.sgst + gl.cess : null;
  return {
    financeDocuments: asRupees(fromFinance), ledger: asRupees(ledger), ledgerDifference: rupees(sum(fromFinance) - sum(ledger)),
    ledgerAgrees: Math.abs(sum(fromFinance) - sum(ledger)) <= 100,
    gl: gl ? asRupees(gl) : null, glDifference: gl ? rupees(reportedTax - glTax) : null, glAgrees: gl ? Math.abs(reportedTax - glTax) <= 100 : null,
    glNote: gl ? "Output-tax accounts' movement in the month (posted journals, any source) against the tax reported." : `${registrations} registrations share the output-tax accounts, so the GL is compared on the company summary only.`,
  };
}

// (Re)builds the working paper from the documents. Allowed while DRAFT or PREPARED; an approved return is reopened first.
export async function prepareGstr1(client, c, input = {}) {
  need(c, P.prepare, "You do not have permission to prepare GST returns.");
  const { registration, row } = await returnFor(client, c, { registrationId: input.registrationId, period: input.period, lock: true, create: true });
  if (["APPROVED", "FILED"].includes(row.status)) throw new GstError(409, `This GSTR-1 is ${row.status.toLowerCase()}; ${row.status === "APPROVED" ? "reopen it to prepare it again" : "a filed return is not changed — correct it as an amendment in a later return"}.`, "GST_RETURN_LOCKED");
  const { start, end } = monthOf(input.period);
  const collected = await collectOutward(client, c, registration, start, end);
  const others = collected.documents.length ? new Map((await client.query(`SELECT DISTINCT d.source_id, to_char(r.period, 'YYYY-MM') AS period FROM tenant.gst_return_documents d
      JOIN tenant.gst_returns r ON r.id = d.return_id WHERE d.organization_id = $1 AND d.return_type = 'GSTR1' AND d.return_id <> $2 AND d.source_id = ANY($3::uuid[])`,
    [c.organizationId, row.id, collected.documents.map((d) => d.sourceId)])).rows.map((r) => [r.source_id, r.period])) : new Map();
  const found = [];
  const documents = [];
  for (const d of collected.documents) {
    if (others.has(d.sourceId)) {
      found.push({ code: "ALREADY_REPORTED", severity: "warning", sourceType: d.sourceType, sourceId: d.sourceId, documentNumber: d.number,
        message: `Already reported in the GSTR-1 for ${others.get(d.sourceId)}; not counted again.` });
      continue;
    }
    documents.push(d);
    for (const x of checkDocument(d, registration, collected)) found.push({ ...x, sourceType: d.sourceType, sourceId: d.sourceId, documentNumber: d.number });
  }
  // documents of approved / filed returns that changed afterwards: amendments, reported on the portal in a later return
  const amended = (await client.query(`SELECT d.source_id, max(d.document_number) AS number, to_char(r.period, 'YYYY-MM') AS period, r.status, i.status AS now_status
      FROM tenant.gst_return_documents d JOIN tenant.gst_returns r ON r.id = d.return_id JOIN tenant.accounting_customer_invoices i ON i.id = d.source_id
      WHERE d.organization_id = $1 AND d.return_type = 'GSTR1' AND r.registration_id = $2 AND r.period < $3 AND r.status IN ('APPROVED', 'FILED')
        AND (i.status IN ('cancelled', 'reversed') OR i.updated_at > r.approved_at) GROUP BY d.source_id, r.period, r.status, i.status`, [c.organizationId, registration.id, start])).rows;
  for (const a of amended) found.push({ code: "AMENDED_AFTER_FILING", severity: "warning", sourceType: "customer_invoice", sourceId: a.source_id, documentNumber: a.number,
    message: `Reported in the ${a.status.toLowerCase()} GSTR-1 for ${a.period} and ${a.now_status === "reversed" || a.now_status === "cancelled" ? `since ${a.now_status}` : "changed since"}: report the amendment on the portal (tables 9A / 9C). Amendments are not part of this export.` });

  await client.query(`DELETE FROM tenant.gst_return_documents WHERE return_id = $1`, [row.id]);
  await client.query(`DELETE FROM tenant.gst_return_hsn WHERE return_id = $1`, [row.id]);
  const sections = Object.fromEntries(Object.keys(GSTR1_SECTIONS).map((k) => [k, { documents: 0, ...zero() }]));
  const nil = {};
  const hsn = new Map();
  const totals = zero();
  for (const d of documents) {
    const section = sectionOf(d);
    const sign = d.kind === "credit_note" ? -1 : 1;
    const groups = new Map();
    for (const l of d.lines) {
      const cls = l.classification ?? "unclassified";
      const s = ["nil_rated", "exempt", "non_gst"].includes(cls) ? "nil" : section;
      const key = `${s}|${cls}|${l.rate}`;
      const g = groups.get(key) ?? { section: s, classification: cls, rate: s === "nil" ? 0 : l.rate, ...zero() };
      addInto(g, l, sign);
      groups.set(key, g);
      if (l.hsn) {
        const hk = `${d.recipientGstin ? "b2b" : "b2c"}|${l.hsn}|${l.uqc}|${l.rate}`;
        const h = hsn.get(hk) ?? { recipient: d.recipientGstin ? "b2b" : "b2c", hsn: l.hsn, description: l.description, uqc: l.uqc, rate: l.rate, quantity: 0, ...zero() };
        h.quantity += sign * l.quantity;
        addInto(h, l, sign);
        hsn.set(hk, h);
      }
    }
    const counted = new Set();
    for (const g of groups.values()) {
      await client.query(`INSERT INTO tenant.gst_return_documents (organization_id, return_id, return_type, section, source_type, source_id, document_type, document_number, document_date,
          counterparty_gstin, counterparty_name, place_of_supply, supply_nature, classification, rate, taxable, igst, cgst, sgst, utgst, cess, document_value, original_number, original_date,
          detail, content_hash)
        VALUES ($1,$2,'GSTR1',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb,$25)`,
        [c.organizationId, row.id, g.section, d.sourceType, d.sourceId, d.kind, d.number, d.date, d.recipientGstin, d.recipientName, d.pos, d.nature, g.classification, g.rate,
          rupees(g.taxable), rupees(g.igst), rupees(g.cgst), rupees(g.sgst), rupees(g.utgst), rupees(g.cess), rupees(sign * d.value), d.original?.number ?? null, d.original?.date ?? null,
          JSON.stringify({ supplyType: d.supplyType, sez: d.supplyType === "sez", ...(d.exportDetails ? { export: d.exportDetails } : {}) }), d.hash]);
      const bucket = sections[g.section];
      if (!counted.has(g.section)) { bucket.documents += 1; counted.add(g.section); }
      addInto(bucket, g);
      if (g.section === "nil") {
        const nk = `${d.nature === "inter" ? "inter" : "intra"}_${d.recipientGstin ? "b2b" : "b2c"}`;
        nil[nk] = nil[nk] ?? { nil_rated: 0, exempt: 0, non_gst: 0 };
        nil[nk][g.classification] += g.taxable;
      }
      if (LIABLE.includes(g.section)) addInto(totals, g);
    }
  }
  for (const h of hsn.values()) {
    await client.query(`INSERT INTO tenant.gst_return_hsn (organization_id, return_id, recipient, hsn_sac, description, uqc, quantity, rate, taxable, igst, cgst, sgst, utgst, cess)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [c.organizationId, row.id, h.recipient, h.hsn, text(h.description, 200) || null, h.uqc, h.quantity, h.rate,
      rupees(h.taxable), rupees(h.igst), rupees(h.cgst), rupees(h.sgst), rupees(h.utgst), rupees(h.cess)]);
  }
  // Tables 11A and 11B: GST on advances, from Sales' receipt and refund vouchers (Sales report Phase 2). Their tax is paid through the
  // return (11A adds it, 11B takes it off) and is not in Finance's ledger, so it stays out of the reconciliation below.
  const advanceTax = { at: zero(), atadj: zero() };
  for (const a of await collectAdvances(client, c, registration, start, end)) {
    await client.query(`INSERT INTO tenant.gst_return_documents (organization_id, return_id, return_type, section, source_type, source_id, document_type, document_number, document_date,
        counterparty_gstin, counterparty_name, place_of_supply, supply_nature, classification, rate, taxable, igst, cgst, sgst, utgst, cess, document_value, original_number, original_date,
        detail, content_hash)
      VALUES ($1,$2,'GSTR1',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'taxable',$13,$14,$15,$16,$17,0,0,$18,$19,$20,'{}'::jsonb,$21)`,
      [c.organizationId, row.id, a.section, a.sourceType, a.sourceId, a.kind, a.number, a.date, a.gstin, a.name, a.pos, a.nature, a.rate,
        rupees(a.taxable), rupees(a.igst), rupees(a.cgst), rupees(a.sgst), rupees(a.value), a.original?.number ?? null, a.original?.date ?? null,
        sha([a.sourceId, a.value, a.taxable, a.igst, a.cgst, a.sgst])]);
    sections[a.section].documents += 1;
    addInto(sections[a.section], a);
    addInto(advanceTax[a.section], a);
  }

  // Table 13: number series by kind, with cancelled documents
  const series = {};
  const nature = (kind, sourceType) => (kind === "credit_note" ? "Credit notes" : kind === "debit_note" ? "Debit notes" : sourceType === "pos_invoice" ? "Invoices (POS)" : "Invoices for outward supply");
  for (const d of collected.documents) (series[nature(d.kind, d.sourceType)] ??= { numbers: [], cancelled: 0 }).numbers.push(d.number);
  for (const x of collected.cancelled) {
    const s = (series[nature(x.kind, x.kind === "pos_invoice" ? "pos_invoice" : "customer_invoice")] ??= { numbers: [], cancelled: 0 });
    s.numbers.push(x.number);
    s.cancelled += 1;
  }
  const docs = Object.entries(series).map(([name, s]) => {
    const sorted = s.numbers.filter(Boolean).sort();
    return { nature: name, from: sorted[0] ?? null, to: sorted.at(-1) ?? null, total: sorted.length, cancelled: s.cancelled };
  });
  sections.docs.documents = docs.reduce((n, d) => n + d.total, 0);
  sections.hsn.documents = hsn.size;
  const reconciliation = await reconcileOutward(client, c, registration, start, end, documents, totals);
  if (!reconciliation.ledgerAgrees) found.push({ code: "LEDGER_MISMATCH", severity: "blocking", detail: "ledger",
    message: `The tax on the reported Finance documents differs from what Finance's tax ledger holds for them by ₹${reconciliation.ledgerDifference}. Find the document before approving.` });
  if (reconciliation.glAgrees === false) found.push({ code: "GL_MISMATCH", severity: "warning", detail: "gl",
    message: `The output-tax accounts moved ₹${reconciliation.glDifference} differently from the tax reported (manual journals, POS or another month's documents?). Review before approving.` });
  const open = await syncExceptions(client, c, row.id, found);
  const summary = {
    sections: Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, { ...asRupees(v), documents: v.documents }])), liability: asRupees(totals),
    nil: Object.fromEntries(Object.entries(nil).map(([k, v]) => [k, asRupees(v)])), docs, documents: documents.length, exceptions: open,
    // The tax on advances (11A less 11B), paid with this return on top of the documents' tax.
    advanceTax: asRupees(addInto(addInto(zero(), advanceTax.at), advanceTax.atadj, -1)),
    unsupported: ["Amendments of earlier returns (9A, 9C, 10, 11)", "Supplies through e-commerce operators (14, 15)"],
  };
  const label = open.blocking ? "Draft — exceptions to resolve" : reconciliation.ledgerAgrees ? "Prepared — ready for approval" : "Draft — reconciliation required";
  const updated = (await client.query(`UPDATE tenant.gst_returns SET status = 'PREPARED', summary = $2::jsonb, reconciliation = $3::jsonb, label = $4, content_hash = $5, prepared_by = $6,
      prepared_at = now(), version = version + 1, updated_at = now() WHERE id = $1 RETURNING *`,
    [row.id, JSON.stringify(summary), JSON.stringify(reconciliation), label, setHash(collected.documents.filter((d) => !others.has(d.sourceId)), collected.cancelled), c.userId ?? null])).rows[0];
  return shapeReturn(updated);
}

export async function approveGstReturn(client, c, id) {
  need(c, P.approve, "You do not have permission to approve GST returns.");
  const r = await loadReturn(client, c, id, { lock: true });
  if (r.status !== "PREPARED") throw new GstError(409, `Only a prepared return can be approved; this one is ${r.status.toLowerCase()}.`, "GST_RETURN_STATE");
  if (r.prepared_by && r.prepared_by === c.userId) throw new GstError(403, "Someone other than the preparer must approve the return.", "GST_SELF_APPROVAL");
  const open = (await client.query(`SELECT count(*)::int AS n FROM tenant.gst_exceptions WHERE return_id = $1 AND status = 'open' AND severity = 'blocking'`, [r.id])).rows[0].n;
  if (open) throw new GstError(409, `${open} blocking exception(s) must be fixed at the source document and the return prepared again.`, "GST_RETURN_BLOCKED");
  if (r.return_type === "GSTR1") {
    const registration = await registrationOf(client, c, r.registration_id);
    const { start, end } = monthOf(ymd(r.period));
    const now = await collectOutward(client, c, registration, start, end);
    const reported = new Set((await client.query(`SELECT DISTINCT source_id FROM tenant.gst_return_documents WHERE return_id = $1`, [r.id])).rows.map((x) => x.source_id));
    const elsewhere = now.documents.filter((d) => !reported.has(d.sourceId));
    const stillOthers = elsewhere.length ? new Set((await client.query(`SELECT DISTINCT source_id FROM tenant.gst_return_documents WHERE organization_id = $1 AND return_type = 'GSTR1' AND return_id <> $2 AND source_id = ANY($3::uuid[])`,
      [c.organizationId, r.id, elsewhere.map((d) => d.sourceId)])).rows.map((x) => x.source_id)) : new Set();
    if (setHash(now.documents.filter((d) => !stillOthers.has(d.sourceId)), now.cancelled) !== r.content_hash) {
      throw new GstError(409, "Documents for this month changed after the return was prepared. Prepare it again, then approve.", "GST_RETURN_STALE");
    }
  } else {
    const { assertGstr3bApprovable } = await import("./gstr3b.js");
    await assertGstr3bApprovable(client, c, r);
  }
  const label = r.return_type === "GSTR1" ? "Approved working data — not filed" : "Approved working paper — not filed";
  return shapeReturn((await client.query(`UPDATE tenant.gst_returns SET status = 'APPROVED', approved_by = $2, approved_at = now(), label = $3, updated_at = now() WHERE id = $1 RETURNING *`,
    [r.id, c.userId ?? null, label])).rows[0]);
}
export async function reopenGstReturn(client, c, id, input = {}) {
  need(c, P.approve, "You do not have permission to reopen GST returns.");
  const r = await loadReturn(client, c, id, { lock: true });
  if (r.status !== "APPROVED") throw new GstError(409, r.status === "FILED" ? "A filed return is not reopened: correct it as an amendment in a later return." : "Only an approved return can be reopened.", "GST_RETURN_STATE");
  const reason = text(input.reason, 500);
  if (!reason) throw new GstError(400, "Say why the return is reopened.", "GST_REASON_REQUIRED");
  return shapeReturn((await client.query(`UPDATE tenant.gst_returns SET status = 'PREPARED', approved_by = NULL, approved_at = NULL, reopened_reason = $2, label = 'Reopened — prepare again and approve', updated_at = now()
    WHERE id = $1 RETURNING *`, [r.id, reason])).rows[0]);
}
// After filing on the portal: the acknowledgement (ARN) and the date. The return is then final.
export async function fileGstReturn(client, c, id, input = {}) {
  need(c, P.file, "You do not have permission to record GST filings.");
  const r = await loadReturn(client, c, id, { lock: true });
  if (r.status !== "APPROVED") throw new GstError(409, "Only an approved return can be recorded as filed.", "GST_RETURN_STATE");
  const reference = text(input.reference, 60);
  if (!reference) throw new GstError(400, "Enter the portal's acknowledgement reference (ARN).", "GST_REFERENCE_REQUIRED");
  const filedOn = ymd(input.filedOn) || ymd(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(filedOn)) throw new GstError(400, "Enter the filing date.", "GST_INVALID");
  return shapeReturn((await client.query(`UPDATE tenant.gst_returns SET status = 'FILED', filing_reference = $2, filed_on = $3, filed_by = $4, filed_at = now(), label = 'Filed on the portal', updated_at = now()
    WHERE id = $1 RETURNING *`, [r.id, reference, filedOn, c.userId ?? null])).rows[0]);
}

export async function waiveGstException(client, c, exceptionId, input = {}) {
  need(c, P.prepare, "You do not have permission to review GST exceptions.");
  const x = (await client.query(`SELECT x.*, r.status AS return_status FROM tenant.gst_exceptions x JOIN tenant.gst_returns r ON r.id = x.return_id WHERE x.organization_id = $1 AND x.id = $2 FOR UPDATE OF x`,
    [c.organizationId, uuid(exceptionId, "Exception")])).rows[0];
  if (!x) throw new GstError(404, "That exception was not found.", "GST_EXCEPTION_NOT_FOUND");
  if (x.severity === "blocking") throw new GstError(409, "A blocking exception is fixed at its source document, not waived.", "GST_EXCEPTION_BLOCKING");
  if (x.status !== "open") throw new GstError(409, `That exception is already ${x.status}.`, "GST_EXCEPTION_STATE");
  if (["APPROVED", "FILED"].includes(x.return_status)) throw new GstError(409, "The return is already approved.", "GST_RETURN_LOCKED");
  const note = text(input.note, 500);
  if (!note) throw new GstError(400, "Say why the warning is accepted.", "GST_REASON_REQUIRED");
  const waived = (await client.query(`UPDATE tenant.gst_exceptions SET status = 'waived', note = $2, decided_by = $3, decided_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
    [x.id, note, c.userId ?? null])).rows[0];
  const { refreshGstr3bLabel } = await import("./gstr3b.js");
  await refreshGstr3bLabel(client, x.return_id);
  return waived;
}

export function shapeReturn(r) {
  return { id: r.id, returnType: r.return_type, registrationId: r.registration_id, gstin: r.gstin, period: ymd(r.period).slice(0, 7), status: r.status, label: r.label,
    summary: r.summary, reconciliation: r.reconciliation, preparedAt: r.prepared_at, preparedBy: r.prepared_by, approvedAt: r.approved_at, approvedBy: r.approved_by,
    filedOn: ymd(r.filed_on), filingReference: r.filing_reference, reopenedReason: r.reopened_reason, version: r.version };
}
export async function listGstReturns(client, c, filters = {}) {
  need(c, P.view, "You do not have permission to see GST returns.");
  const params = [c.organizationId];
  let extra = "";
  if (filters.registrationId) { params.push(uuid(filters.registrationId, "GST registration")); extra += ` AND registration_id = $${params.length}`; }
  if (filters.returnType) { params.push(String(filters.returnType)); extra += ` AND return_type = $${params.length}`; }
  return (await client.query(`SELECT * FROM tenant.gst_returns WHERE organization_id = $1${extra} ORDER BY period DESC, return_type LIMIT 240`, params)).rows.map(shapeReturn);
}
export async function getGstReturn(client, c, id, { section } = {}) {
  need(c, P.view, "You do not have permission to see GST returns.");
  const r = await loadReturn(client, c, id);
  const exceptions = (await client.query(`SELECT x.id, x.code, x.severity, x.status, x.source_type, x.source_id, x.document_number, x.message, x.note, u.full_name AS decided_by
      FROM tenant.gst_exceptions x LEFT JOIN public.users u ON u.id = x.decided_by WHERE x.return_id = $1 AND x.status <> 'resolved'
      ORDER BY (x.status = 'open') DESC, (x.severity = 'blocking') DESC, x.document_number`, [r.id])).rows;
  const rows = section && section !== "hsn" ? (await client.query(`SELECT * FROM tenant.gst_return_documents WHERE return_id = $1 AND section = $2 ORDER BY document_date, document_number, rate`, [r.id, section])).rows : [];
  const hsn = section === "hsn" ? (await client.query(`SELECT * FROM tenant.gst_return_hsn WHERE return_id = $1 ORDER BY recipient, hsn_sac, rate`, [r.id])).rows : [];
  return { ...shapeReturn(r), exceptions, rows, hsn, canApprove: can(c, P.approve) && r.prepared_by !== c.userId, sections: GSTR1_SECTIONS };
}

// Working data for one section, as CSV (amounts in rupees; B2CS and nil-rated are aggregated as the return asks).
export async function exportGstr1Section(client, c, id, section) {
  need(c, P.view, "You do not have permission to export GST returns.");
  const r = await loadReturn(client, c, id);
  if (!GSTR1_SECTIONS[section]) throw new GstError(400, "Choose a GSTR-1 section.", "GST_INVALID");
  const docs = (await client.query(`SELECT * FROM tenant.gst_return_documents WHERE return_id = $1 AND section = $2 ORDER BY document_date, document_number, rate`, [r.id, section])).rows;
  const n = (v) => Number(v ?? 0).toFixed(2);
  const pos = (code) => code ?? "";
  let header;
  let lines;
  const abs = (v) => n(Math.abs(Number(v)));
  switch (section) {
    case "b2b": header = ["GSTIN of recipient", "Receiver name", "Invoice number", "Invoice date", "Invoice value", "Place of supply", "Reverse charge", "Invoice type", "Rate", "Taxable value", "IGST", "CGST", "SGST/UTGST", "Cess"];
      lines = docs.map((d) => [d.counterparty_gstin, d.counterparty_name, d.document_number, ymd(d.document_date), n(d.document_value), pos(d.place_of_supply), "N",
        d.detail?.sez ? (Number(d.igst) > 0 ? "SEZ supplies with payment" : "SEZ supplies without payment") : "Regular B2B", Number(d.rate), n(d.taxable), n(d.igst), n(d.cgst), n(Number(d.sgst) + Number(d.utgst)), n(d.cess)]); break;
    case "b2cl": header = ["Invoice number", "Invoice date", "Invoice value", "Place of supply", "Rate", "Taxable value", "IGST", "Cess"];
      lines = docs.map((d) => [d.document_number, ymd(d.document_date), n(d.document_value), pos(d.place_of_supply), Number(d.rate), n(d.taxable), n(d.igst), n(d.cess)]); break;
    case "b2cs": {
      const g = new Map();
      for (const d of docs) {
        const k = `${d.place_of_supply}|${d.rate}|${d.supply_nature}`;
        const t = g.get(k) ?? { pos: d.place_of_supply, rate: Number(d.rate), nature: d.supply_nature, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
        for (const h of ["taxable", "igst", "cgst", "cess"]) t[h] += Number(d[h]);
        t.sgst += Number(d.sgst) + Number(d.utgst);
        g.set(k, t);
      }
      header = ["Type", "Place of supply", "Supply", "Rate", "Taxable value", "IGST", "CGST", "SGST/UTGST", "Cess"];
      lines = [...g.values()].map((t) => ["OE", pos(t.pos), t.nature === "inter" ? "Inter-state" : "Intra-state", t.rate, n(t.taxable), n(t.igst), n(t.cgst), n(t.sgst), n(t.cess)]); break;
    }
    case "cdnr": header = ["GSTIN of recipient", "Receiver name", "Note number", "Note date", "Note type", "Place of supply", "Note value", "Original invoice", "Original date", "Rate", "Taxable value", "IGST", "CGST", "SGST/UTGST", "Cess"];
      lines = docs.map((d) => [d.counterparty_gstin, d.counterparty_name, d.document_number, ymd(d.document_date), d.document_type === "credit_note" ? "C" : "D", pos(d.place_of_supply), abs(d.document_value),
        d.original_number ?? "", ymd(d.original_date) ?? "", Number(d.rate), abs(d.taxable), abs(d.igst), abs(d.cgst), abs(Number(d.sgst) + Number(d.utgst)), abs(d.cess)]); break;
    case "cdnur": header = ["UR type", "Note number", "Note date", "Note type", "Place of supply", "Note value", "Rate", "Taxable value", "IGST", "Cess"];
      lines = docs.map((d) => [d.detail?.supplyType === "export" ? (Number(d.igst) > 0 ? "EXPWP" : "EXPWOP") : "B2CL", d.document_number, ymd(d.document_date), d.document_type === "credit_note" ? "C" : "D",
        pos(d.place_of_supply), abs(d.document_value), Number(d.rate), abs(d.taxable), abs(d.igst), abs(d.cess)]); break;
    case "exp": header = ["Export type", "Invoice number", "Invoice date", "Invoice value", "Port code", "Shipping bill number", "Shipping bill date", "Rate", "Taxable value", "IGST", "Cess"];
      lines = docs.map((d) => [Number(d.igst) > 0 ? "WPAY" : "WOPAY", d.document_number, ymd(d.document_date), n(d.document_value), d.detail?.export?.portCode ?? "",
        d.detail?.export?.shippingBillNumber ?? "", d.detail?.export?.shippingBillDate ?? "", Number(d.rate), n(d.taxable), n(d.igst), n(d.cess)]); break;
    case "nil": {
      const s = r.summary?.nil ?? {};
      header = ["Description", "Nil-rated supplies", "Exempted (other than nil-rated / non-GST)", "Non-GST supplies"];
      const label = { inter_b2b: "Inter-state supplies to registered persons", intra_b2b: "Intra-state supplies to registered persons", inter_b2c: "Inter-state supplies to unregistered persons", intra_b2c: "Intra-state supplies to unregistered persons" };
      lines = Object.entries(label).map(([k, l]) => [l, n(s[k]?.nil_rated), n(s[k]?.exempt), n(s[k]?.non_gst)]); break;
    }
    case "hsn": {
      const rows = (await client.query(`SELECT * FROM tenant.gst_return_hsn WHERE return_id = $1 ORDER BY recipient, hsn_sac, rate`, [r.id])).rows;
      header = ["B2B / B2C", "HSN", "Description", "UQC", "Total quantity", "Rate", "Taxable value", "IGST", "CGST", "SGST/UTGST", "Cess"];
      lines = rows.map((h) => [h.recipient.toUpperCase(), h.hsn_sac, h.description ?? "", h.uqc, Number(h.quantity), Number(h.rate), n(h.taxable), n(h.igst), n(h.cgst), n(Number(h.sgst) + Number(h.utgst)), n(h.cess)]); break;
    }
    case "at":
    case "atadj": {
      const g = new Map();
      for (const d of docs) {
        const k = `${d.place_of_supply}|${d.rate}|${d.supply_nature}`;
        const t = g.get(k) ?? { pos: d.place_of_supply, rate: Number(d.rate), nature: d.supply_nature, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
        for (const h of ["taxable", "igst", "cgst", "sgst"]) t[h] += Number(d[h]);
        g.set(k, t);
      }
      header = ["Place of supply", "Supply", "Rate", section === "at" ? "Gross advance received (taxable value)" : "Gross advance adjusted (taxable value)", "IGST", "CGST", "SGST/UTGST", "Cess"];
      lines = [...g.values()].map((t) => [pos(t.pos), t.nature === "inter" ? "Inter-state" : "Intra-state", t.rate, n(t.taxable), n(t.igst), n(t.cgst), n(t.sgst), n(0)]); break;
    }
    default: header = ["Nature of document", "Serial from", "Serial to", "Total number", "Cancelled"];
      lines = (r.summary?.docs ?? []).map((d) => [d.nature, d.from ?? "", d.to ?? "", d.total, d.cancelled]);
  }
  const cell = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return { fileName: `gstr1-working-${r.gstin}-${ymd(r.period).slice(0, 7)}-${section}.csv`, mimeType: "text/csv",
    body: [header.join(","), ...lines.map((l) => l.map(cell).join(","))].join("\n"), note: "GSTR-1 working data. Not the GST portal's offline-tool file: enter or upload it through the portal's own tools." };
}
