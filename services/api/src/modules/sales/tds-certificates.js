// Customer TDS certificates (Sales report Phase 3). A customer who deducts TDS on its payments must send a Form 16A for each quarter;
// the seller matches it with Form 26AS to claim the credit. For a financial year, each customer and quarter shows the TDS recorded on
// its payments (expected), the certificates received, what is missing, and whether the certificate is overdue (16A is due by 15 Aug,
// 15 Nov, 15 Feb and 15 Jun for the four quarters). Whoever sees customer balances or records payments works it.
import { SalesError } from "./index.js";
import { companyToday } from "./today.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const rupees = (value) => Math.round(Number(value) * 100) / 100;
const can = (context, permission) => Boolean(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(permission));
export const TDS_QUARTERS = Object.freeze([
  { quarter: 1, label: "Q1 (Apr–Jun)", months: [4, 6], due: (year) => `${year}-08-15` },
  { quarter: 2, label: "Q2 (Jul–Sep)", months: [7, 9], due: (year) => `${year}-11-15` },
  { quarter: 3, label: "Q3 (Oct–Dec)", months: [10, 12], due: (year) => `${year + 1}-02-15` },
  { quarter: 4, label: "Q4 (Jan–Mar)", months: [1, 3], due: (year) => `${year + 1}-06-15` },
]);

function requireAccess(context) {
  if (!can(context, "sales.customers.view_financials") && !can(context, "sales.invoice.record_payment") && !can(context, "accounting.receipts.manage"))
    throw new SalesError(403, "You do not have permission to see customer TDS.", "PERMISSION_DENIED");
}

// The financial year (by its first year: 2026 is April 2026 to March 2027) a date falls in.
export const financialYearOf = (day) => (Number(day.slice(5, 7)) >= 4 ? Number(day.slice(0, 4)) : Number(day.slice(0, 4)) - 1);

// options: { financialYear? (default: the current one), partyId? }
export async function getTdsCertificates(client, context, options = {}) {
  requireAccess(context);
  const today = await companyToday(client);
  const year = Number(options.financialYear) || financialYearOf(today);
  const from = `${year}-04-01`;
  const to = `${year + 1}-03-31`;
  const values = [context.organizationId, from, to];
  const party = UUID.test(String(options.partyId ?? "")) ? (values.push(options.partyId), `AND receipt.party_id = $${values.length}`) : "";
  // TDS recorded on payments of the year (live allocations of live receipts), by customer and quarter.
  const deducted = (await client.query(
    `SELECT receipt.party_id, party.display_name, party.pan, extract(month FROM receipt.receipt_date)::int AS month, sum(allocation.withholding_amount) AS tds,
            string_agg(DISTINCT allocation.withholding_section, ', ') AS sections
       FROM tenant.accounting_customer_receipt_allocations allocation
       JOIN tenant.accounting_customer_receipts receipt ON receipt.id = allocation.receipt_id AND receipt.status NOT IN ('reversed', 'draft', 'cancelled')
       JOIN tenant.business_parties party ON party.organization_id = receipt.organization_id AND party.id = receipt.party_id
      WHERE allocation.organization_id = $1 AND receipt.receipt_date BETWEEN $2::date AND $3::date AND allocation.withholding_amount > 0 ${party}
        AND NOT EXISTS (SELECT 1 FROM tenant.accounting_customer_receipt_allocation_reversals undone WHERE undone.organization_id = $1 AND undone.allocation_id = allocation.id)
      GROUP BY receipt.party_id, party.display_name, party.pan, extract(month FROM receipt.receipt_date)`, values)).rows;
  const certificates = (await client.query(
    `SELECT certificate.*, certificate.received_on::text AS received_day, party.display_name, party.pan FROM tenant.sales_tds_certificates certificate
       JOIN tenant.business_parties party ON party.organization_id = certificate.organization_id AND party.id = certificate.party_id
      WHERE certificate.organization_id = $1 AND certificate.financial_year = $2${UUID.test(String(options.partyId ?? "")) ? " AND certificate.party_id = $3" : ""}
      ORDER BY certificate.received_on`, UUID.test(String(options.partyId ?? "")) ? [context.organizationId, year, options.partyId] : [context.organizationId, year])).rows;
  const quarterOf = (month) => TDS_QUARTERS.find((entry) => month >= entry.months[0] && month <= entry.months[1]);
  const rows = new Map();
  const rowFor = (partyId, name, pan, quarter) => {
    const key = `${partyId}|${quarter.quarter}`;
    if (!rows.has(key)) rows.set(key, { partyId, customerName: name, pan, quarter: quarter.quarter, quarterLabel: quarter.label, dueOn: quarter.due(year), expected: 0, received: 0, sections: new Set(), certificates: [] });
    return rows.get(key);
  };
  for (const entry of deducted) {
    const row = rowFor(entry.party_id, entry.display_name, entry.pan, quarterOf(entry.month));
    row.expected = rupees(row.expected + Number(entry.tds));
    for (const section of String(entry.sections ?? "").split(", ").filter(Boolean)) row.sections.add(section);
  }
  for (const certificate of certificates) {
    const row = rowFor(certificate.party_id, certificate.display_name, certificate.pan, TDS_QUARTERS[certificate.quarter - 1]);
    row.received = rupees(row.received + Number(certificate.amount));
    row.certificates.push({ id: certificate.id, number: certificate.certificate_number, amount: Number(certificate.amount), receivedOn: certificate.received_day, section: certificate.section });
  }
  const list = [...rows.values()].map((row) => {
    const missing = rupees(row.expected - row.received);
    const status = missing <= 0.005 ? "received" : row.received > 0 ? "partly" : "missing";
    return { ...row, sections: [...row.sections], missing: Math.max(0, missing), status, overdue: status !== "received" && today > row.dueOn };
  }).sort((a, b) => a.quarter - b.quarter || a.customerName.localeCompare(b.customerName));
  const total = (key) => rupees(list.reduce((sum, row) => sum + row[key], 0));
  return { financialYear: year, label: `${year}-${String(year + 1).slice(2)}`, rows: list, totals: { expected: total("expected"), received: total("received"), missing: total("missing") },
    overdue: list.filter((row) => row.overdue).length };
}

// input: { partyId, financialYear, quarter, certificateNumber, amount, receivedOn?, section?, notes? }
export async function recordTdsCertificate(client, context, input = {}) {
  requireAccess(context);
  if (!UUID.test(String(input.partyId ?? ""))) throw new SalesError(400, "Choose the customer.", "SALES_TDS_INVALID", { field: "partyId" });
  const year = Number(input.financialYear);
  const quarter = Number(input.quarter);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new SalesError(400, "Choose the financial year.", "SALES_TDS_INVALID", { field: "financialYear" });
  if (![1, 2, 3, 4].includes(quarter)) throw new SalesError(400, "Choose the quarter.", "SALES_TDS_INVALID", { field: "quarter" });
  const number = String(input.certificateNumber ?? "").trim().slice(0, 40);
  if (!number) throw new SalesError(400, "Enter the certificate number.", "SALES_TDS_INVALID", { field: "certificateNumber" });
  const amount = rupees(input.amount);
  if (!(amount > 0)) throw new SalesError(400, "Enter the TDS the certificate shows.", "SALES_TDS_INVALID", { field: "amount" });
  const today = await companyToday(client);
  const receivedOn = input.receivedOn ? String(input.receivedOn).slice(0, 10) : today;
  if (!DATE.test(receivedOn) || receivedOn > today) throw new SalesError(400, "Enter the day it was received (not in the future).", "SALES_TDS_INVALID", { field: "receivedOn" });
  const party = (await client.query("SELECT 1 FROM tenant.business_parties WHERE organization_id = $1 AND id = $2", [context.organizationId, input.partyId])).rows[0];
  if (!party) throw new SalesError(404, "Customer not found.", "SALES_CUSTOMER_NOT_FOUND");
  const row = (await client.query(
    `INSERT INTO tenant.sales_tds_certificates (organization_id, party_id, financial_year, quarter, certificate_number, amount, received_on, section, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (organization_id, party_id, certificate_number) DO NOTHING RETURNING id`,
    [context.organizationId, input.partyId, year, quarter, number, amount, receivedOn, String(input.section ?? "").trim().slice(0, 20) || null,
      String(input.notes ?? "").trim().slice(0, 500) || null, context.userId ?? null])).rows[0];
  if (!row) throw new SalesError(409, `Certificate ${number} is already recorded for this customer.`, "SALES_TDS_DUPLICATE");
  return { certificateId: row.id };
}

export async function deleteTdsCertificate(client, context, certificateId) {
  requireAccess(context);
  const removed = await client.query("DELETE FROM tenant.sales_tds_certificates WHERE organization_id = $1 AND id = $2 RETURNING id",
    [context.organizationId, UUID.test(String(certificateId ?? "")) ? certificateId : null]);
  if (!removed.rows[0]) throw new SalesError(404, "Certificate not found.", "SALES_TDS_NOT_FOUND");
  return { deleted: true };
}
