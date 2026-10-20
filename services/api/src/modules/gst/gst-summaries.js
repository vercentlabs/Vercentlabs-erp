// GST — the outward and inward summaries of one company registration, by month, classification and tax head. Outward: what was issued
// (the same documents GSTR-1 reports). Inward: Finance's tax ledger of supplier invoices, supplier notes and expenses, with the credit split
// into claimable (confirmed), awaiting confirmation and not claimable — supplier GST shown on an invoice is not automatically credit.
import { GST_PERMISSIONS as P, GstError, HEADS, addInto, asRupees, defaultRegistrationId, monthOf, need, paise, registrationOf, zero } from "./gst-common.js";
import { checkDocument, collectOutward } from "./gst-outward.js";

function range(input) {
  const from = monthOf(input.from ?? input.to);
  const to = monthOf(input.to ?? input.from);
  if (to.start < from.start) throw new GstError(400, "The end month is before the start month.", "GST_PERIOD_INVALID");
  const months = (Number(to.month.slice(0, 4)) - Number(from.month.slice(0, 4))) * 12 + Number(to.month.slice(5)) - Number(from.month.slice(5)) + 1;
  if (months > 12) throw new GstError(400, "Choose up to twelve months.", "GST_PERIOD_INVALID");
  return { start: from.start, end: to.end };
}

export async function outwardGstSummary(client, c, input = {}) {
  need(c, P.view, "You do not have permission to see GST summaries.");
  const registration = await registrationOf(client, c, input.registrationId);
  const { start, end } = range(input);
  const { documents, sellerState } = await collectOutward(client, c, registration, start, end);
  const rows = new Map();
  let problems = 0;
  for (const d of documents) {
    problems += checkDocument(d, registration, { sellerState }).filter((x) => x.severity === "blocking").length ? 1 : 0;
    const sign = d.kind === "credit_note" ? -1 : 1;
    for (const l of d.lines) {
      const key = `${d.date.slice(0, 7)}|${l.classification ?? "unclassified"}`;
      const row = rows.get(key) ?? { month: d.date.slice(0, 7), classification: l.classification ?? "unclassified", documents: new Set(), ...zero() };
      row.documents.add(d.sourceId);
      addInto(row, l, sign);
      rows.set(key, row);
    }
  }
  const out = [...rows.values()].sort((a, b) => a.month.localeCompare(b.month) || a.classification.localeCompare(b.classification))
    .map((r) => ({ ...asRupees({ ...r, documents: 0 }), documents: r.documents.size }));
  const total = asRupees(out.reduce((t, r) => addInto(t, { taxable: Math.round(r.taxable * 100), ...Object.fromEntries(HEADS.map((k) => [k, Math.round(r[k] * 100)])) }), zero()));
  return { gstin: registration.registration_number, from: start, to: end, rows: out, total, documentsWithProblems: problems };
}

export async function inwardGstSummary(client, c, input = {}) {
  need(c, P.view, "You do not have permission to see GST summaries.");
  const registration = await registrationOf(client, c, input.registrationId);
  const isDefault = (await defaultRegistrationId(client, c)) === registration.id;
  const { start, end } = range(input);
  const ledger = (await client.query(`SELECT t.source_type, t.source_id, t.tax_type, t.tax_period, t.taxable_amount, t.tax_amount, t.itc_status, t.reverse_charge, t.supply_category,
        b.buying_registration_id, b.reverse_charge AS bill_reverse_charge
      FROM tenant.accounting_tax_ledger t LEFT JOIN tenant.accounting_vendor_bills b ON b.id = t.source_id AND t.source_type IN ('vendor_bill', 'vendor_credit_note')
      WHERE t.organization_id = $1 AND t.direction = 'input' AND t.status <> 'reversed' AND t.tax_period BETWEEN $2 AND $3
        AND (CASE WHEN t.source_type IN ('vendor_bill', 'vendor_credit_note') AND b.buying_registration_id IS NOT NULL THEN b.buying_registration_id = $4 ELSE $5 END)`,
    [c.organizationId, start.slice(0, 7), end.slice(0, 7), registration.id, isDefault])).rows;
  const rows = new Map();
  for (const t of ledger) {
    const gst = HEADS.includes(t.tax_type);
    const classification = t.reverse_charge || t.bill_reverse_charge ? "reverse_charge" : gst || Number(t.tax_amount) ? "taxable" : t.supply_category ?? "unclassified";
    const status = gst ? t.itc_status : "NOT_APPLICABLE";
    const key = `${t.tax_period}|${classification}|${status}`;
    const row = rows.get(key) ?? { month: t.tax_period, classification, itcStatus: status, documents: new Set(), ...zero() };
    row.documents.add(t.source_id);
    if (gst) row[t.tax_type] += paise(t.tax_amount);
    // the taxable value once per line: on its CGST or IGST component, or the untaxed line itself
    if (t.tax_type === "cgst" || t.tax_type === "igst" || (!gst && !Number(t.tax_amount))) row.taxable += paise(t.taxable_amount);
    rows.set(key, row);
  }
  const out = [...rows.values()].sort((a, b) => a.month.localeCompare(b.month) || a.classification.localeCompare(b.classification) || a.itcStatus.localeCompare(b.itcStatus))
    .map((r) => ({ ...asRupees({ ...r, documents: 0 }), documents: r.documents.size }));
  const credit = (s) => asRupees(out.filter((r) => r.itcStatus === s).reduce((t, r) => addInto(t, Object.fromEntries(["taxable", ...HEADS].map((k) => [k, Math.round(r[k] * 100)]))), zero()));
  return { gstin: registration.registration_number, from: start, to: end, rows: out, claimable: credit("ELIGIBLE"), pending: credit("PENDING"), notClaimable: credit("INELIGIBLE") };
}
