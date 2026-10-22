// Reports worked out in code rather than one query (Sales plan, one Reports page): the GST tab reads the same outward supplies GSTR-1 is
// prepared from (modules/gst collectOutward: posted invoices, debit and credit notes, POS GST invoices, each with its own tax split), and
// the Collections tab's ageing reads Finance's ledger. Company-wide figures: the GST tab needs every invoice in view (or GST access).
import { collectOutward, sectionOf } from "../../gst/gst-outward.js";
import { registrationOf } from "../../gst/gst-common.js";
import { getCustomerOutstanding } from "../customers/ledger.js";
import { SalesError } from "../index.js";

export const COMPUTED_REPORTS = Object.freeze(["gst-outward", "gst-hsn", "gst-notes", "gst-documents", "collections-ageing"]);
const SECTION_LABELS = Object.freeze({ b2b: "B2B (registered customers)", b2cl: "B2C large (inter-state above ₹1 lakh)", b2cs: "B2C small", exp: "Exports and SEZ",
  cdnr: "Credit / debit notes (registered)", cdnur: "Credit / debit notes (unregistered)" });
const KIND_LABELS = Object.freeze({ invoice: "Invoice", credit_note: "Credit note", debit_note: "Debit note" });
const rupees = (paise) => (Math.round(Number(paise ?? 0)) / 100).toFixed(2);
const can = (context, permission) => context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(permission);

// The financial year so far when no dates are given.
function periodOf(filter) {
  const today = new Date();
  const year = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return { from: filter.from ?? `${year}-04-01`, to: filter.to ?? today.toISOString().slice(0, 10) };
}

async function outward(client, context, filter) {
  if (!can(context, "sales.invoice.view_all") && !can(context, "gst.view"))
    throw new SalesError(403, "The GST reports cover every invoice: they need permission to see all invoices, or GST access.", "PERMISSION_DENIED");
  const registration = await registrationOf(client, context, filter.registration ?? undefined).catch((error) => {
    throw new SalesError(error.status ?? 409, error.message, "SALES_REPORT_GST_UNAVAILABLE");
  });
  const { from, to } = periodOf(filter);
  const { documents } = await collectOutward(client, context, registration, from, to);
  return documents.filter((document) => !filter.customerGstin || document.recipientGstin === filter.customerGstin);
}

const heads = (lines) => lines.reduce((total, line) => ({ taxable: total.taxable + Number(line.taxable ?? 0), igst: total.igst + Number(line.igst ?? 0), cgst: total.cgst + Number(line.cgst ?? 0),
  sgst: total.sgst + Number(line.sgst ?? 0) + Number(line.utgst ?? 0), cess: total.cess + Number(line.cess ?? 0) }), { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });

// filter: the checked report filters ({ from, to, customer, salesperson, registration, currency }).
export async function computedSalesReport(client, context, key, filter) {
  if (key === "collections-ageing") {
    const outstanding = await getCustomerOutstanding(client, context, { asOf: filter.to ?? undefined });
    return outstanding.rows.filter((row) => !filter.customer || row.partyId === filter.customer).map((row) => ({
      customer_id: row.partyId, customer: row.name, code: row.code ?? null, currency: outstanding.currencyCode,
      not_due: row.notDue.toFixed(2), d1_30: row.d1_30.toFixed(2), d31_60: row.d31_60.toFixed(2), d61_90: row.d61_90.toFixed(2), over_90: row.over90.toFixed(2),
      credits: row.credits.toFixed(2), owes: row.net.toFixed(2), oldest_days_overdue: row.oldestDaysPastDue ?? null, promised_date: row.promisedDate ?? null,
    }));
  }
  const documents = await outward(client, context, filter);
  const sign = (document) => (document.kind === "credit_note" ? -1 : 1);
  if (key === "gst-outward") {
    const sections = new Map();
    for (const document of documents) {
      const section = sectionOf(document);
      const row = sections.get(section) ?? { section, documents: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
      const sum = heads(document.lines);
      row.documents += 1;
      for (const head of ["taxable", "igst", "cgst", "sgst", "cess"]) row[head] += sign(document) * sum[head];
      sections.set(section, row);
    }
    return ["b2b", "b2cl", "b2cs", "exp", "cdnr", "cdnur"].filter((section) => sections.has(section)).map((section) => {
      const row = sections.get(section);
      return { section: SECTION_LABELS[section], documents: row.documents, taxable: rupees(row.taxable), igst: rupees(row.igst), cgst: rupees(row.cgst), sgst: rupees(row.sgst),
        cess: rupees(row.cess), tax: rupees(row.igst + row.cgst + row.sgst + row.cess) };
    });
  }
  if (key === "gst-hsn") {
    const rows = new Map();
    for (const document of documents) for (const line of document.lines) {
      const hsn = line.hsn || "Not recorded";
      const id = `${hsn}|${line.uqc ?? ""}|${line.rate}`;
      const row = rows.get(id) ?? { hsn, uqc: line.uqc ?? "OTH", rate: line.rate, quantity: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
      const s = sign(document);
      row.quantity += s * Number(line.quantity ?? 0);
      for (const [head, value] of Object.entries(heads([line]))) row[head] += s * value;
      rows.set(id, row);
    }
    return [...rows.values()].sort((a, b) => b.taxable - a.taxable).map((row) => ({ hsn: row.hsn, uqc: row.uqc, rate_pct: row.rate, quantity: Math.round(row.quantity * 1000) / 1000,
      taxable: rupees(row.taxable), igst: rupees(row.igst), cgst: rupees(row.cgst), sgst: rupees(row.sgst), cess: rupees(row.cess) }));
  }
  if (key === "gst-notes") {
    return documents.filter((document) => document.kind !== "invoice").map((document) => {
      const sum = heads(document.lines);
      return { document: KIND_LABELS[document.kind] ?? document.kind, document_number: document.number, document_date: document.date, original_invoice: document.original?.number ?? null,
        customer: document.recipientName ?? null, gstin: document.recipientGstin ?? null, taxable: rupees(sum.taxable), tax: rupees(sum.igst + sum.cgst + sum.sgst + sum.cess) };
    });
  }
  // gst-documents: the documents issued (GSTR-1 table 13), each kind's first and last number and count.
  const kinds = new Map();
  for (const document of documents) {
    const row = kinds.get(document.kind) ?? { kind: document.kind, numbers: [] };
    row.numbers.push(document.number);
    kinds.set(document.kind, row);
  }
  return [...kinds.values()].map((row) => {
    const sorted = [...row.numbers].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    return { document: KIND_LABELS[row.kind] ?? row.kind, first_number: sorted[0], last_number: sorted.at(-1), issued: sorted.length };
  });
}
