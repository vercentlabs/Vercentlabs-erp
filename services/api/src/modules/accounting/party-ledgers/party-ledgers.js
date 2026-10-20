// Customer and supplier ledgers (Finance MVP F4/F5): aging and statements, the same way for both sides.
//
//   aging       what each party owes (or is owed), by how long past due: not yet due, 1–30, 31–60, 61–90 and over 90 days. Open invoices
//               (or bills) count by their due date; unapplied credit notes and unapplied receipts (or payments) are credits the party holds.
//               Amounts in the company's currency (outstanding × the document's rate), so the total agrees with the control account.
//   statement   every posting to the party's control account between two dates — invoices, credit notes, receipts, refunds, write-offs,
//               exchange differences and reversals — with the balance brought forward and a running balance, straight from the ledger, so a
//               statement always agrees with the books.
import { ACCOUNTING_PERMISSIONS, AccountingError, isoDate, requirePermission, uuid } from "../core.js";
import { localToday } from "../journals.js";
import { postingEventOf, sourceHref } from "../posting-service.js";

const OPEN = ["posted", "partially_paid", "overdue", "disputed"];
export const SIDES = Object.freeze({
  receivable: {
    permission: ACCOUNTING_PERMISSIONS.view, partyTypes: ["customer", "both"], partyLabel: "customer",
    documents: { table: "accounting_customer_invoices", number: "invoice_number", date: "invoice_date", type: "invoice_type" },
    money: { table: "accounting_customer_receipts", number: "receipt_number", date: "receipt_date", label: "Unapplied receipt" },
    controlKind: "receivable",
  },
  payable: {
    permission: ACCOUNTING_PERMISSIONS.view, partyTypes: ["supplier", "both"], partyLabel: "supplier",
    documents: { table: "accounting_vendor_bills", number: "bill_number", date: "bill_date", type: "bill_type" },
    money: { table: "accounting_vendor_payments", number: "payment_number", date: "payment_date", label: "Unapplied payment" },
    controlKind: "payable",
  },
});
export const BUCKETS = Object.freeze([
  { key: "notDue", label: "Not yet due" }, { key: "d1_30", label: "1–30 days" }, { key: "d31_60", label: "31–60 days" }, { key: "d61_90", label: "61–90 days" },
  { key: "over90", label: "Over 90 days" },
]);
const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const side = (key) => SIDES[key] ?? (() => { throw new AccountingError(400, "Choose receivables or payables.", "ACCOUNTING_SIDE_INVALID"); })();
const bucketOf = (daysPastDue) => (daysPastDue <= 0 ? "notDue" : daysPastDue <= 30 ? "d1_30" : daysPastDue <= 60 ? "d31_60" : daysPastDue <= 90 ? "d61_90" : "over90");

// Every open item of one side (debit documents, credit notes and unapplied money), in the company's currency, with its days past due.
async function openItems(client, context, config, asOf, partyId = null) {
  const { documents: d, money: m } = config;
  const values = [context.organizationId, OPEN, asOf, partyId];
  const docs = (await client.query(
    `SELECT doc.id, doc.party_id, doc.${d.number} AS number, doc.${d.date} AS date, doc.due_date, doc.${d.type} AS type, doc.currency_code,
            doc.grand_total, doc.outstanding_amount, round(doc.outstanding_amount * COALESCE(doc.exchange_rate, 1), 2) AS base_outstanding,
            GREATEST(0, $3::date - COALESCE(doc.due_date, doc.${d.date})) AS days_past_due
       FROM tenant.${d.table} doc
      WHERE doc.organization_id = $1 AND doc.status = ANY($2::text[]) AND doc.outstanding_amount > 0 AND ($4::uuid IS NULL OR doc.party_id = $4)
      ORDER BY doc.due_date NULLS LAST, doc.${d.date}`, values)).rows;
  const unapplied = (await client.query(
    `SELECT money.id, money.party_id, money.${m.number} AS number, money.${m.date} AS date, money.currency_code, money.unapplied_amount,
            round(money.unapplied_amount * COALESCE(money.exchange_rate, 1), 2) AS base_unapplied
       FROM tenant.${m.table} money
      WHERE money.organization_id = $1 AND money.status IN ('posted', 'partially_applied') AND money.unapplied_amount > 0 AND ($2::uuid IS NULL OR money.party_id = $2)
      ORDER BY money.${m.date}`, [context.organizationId, partyId])).rows;
  return [
    ...docs.map((row) => {
      const credit = row.type === "credit_note";
      return { id: row.id, partyId: row.party_id, kind: credit ? "credit_note" : row.type, number: row.number, date: row.date, dueDate: row.due_date, currency: String(row.currency_code).trim(),
        outstanding: money(row.outstanding_amount), amount: credit ? -money(row.base_outstanding) : money(row.base_outstanding), daysPastDue: credit ? 0 : Number(row.days_past_due),
        bucket: credit ? "credit" : bucketOf(Number(row.days_past_due)) };
    }),
    ...unapplied.map((row) => ({ id: row.id, partyId: row.party_id, kind: "unapplied", number: row.number, date: row.date, dueDate: null, currency: String(row.currency_code).trim(),
      outstanding: money(row.unapplied_amount), amount: -money(row.base_unapplied), daysPastDue: 0, bucket: "credit" })),
  ];
}

// The aging of one side as of a date (today by default): one row per party, the buckets, the credits it holds and its net balance.
export async function getPartyAging(client, context, sideKey, filters = {}) {
  const config = side(sideKey);
  requirePermission(context, config.permission);
  const asOf = filters.asOf ? isoDate(filters.asOf, "As of") : localToday();
  const items = await openItems(client, context, config, asOf);
  const names = new Map((await client.query("SELECT id, display_name, customer_number, code FROM tenant.business_parties WHERE organization_id = $1", [context.organizationId])).rows
    .map((row) => [row.id, { name: row.display_name, code: row.customer_number ?? row.code ?? null }]));
  const parties = new Map();
  for (const item of items) {
    const party = parties.get(item.partyId) ?? { partyId: item.partyId, name: names.get(item.partyId)?.name ?? "Unknown", code: names.get(item.partyId)?.code ?? null,
      ...Object.fromEntries(BUCKETS.map((bucket) => [bucket.key, 0])), credits: 0, net: 0, documents: 0, oldestDaysPastDue: 0 };
    if (item.bucket === "credit") party.credits = money(party.credits + item.amount);
    else { party[item.bucket] = money(party[item.bucket] + item.amount); party.documents += 1; party.oldestDaysPastDue = Math.max(party.oldestDaysPastDue, item.daysPastDue); }
    party.net = money(party.net + item.amount);
    parties.set(item.partyId, party);
  }
  const rows = [...parties.values()].sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));
  const totals = { ...Object.fromEntries(BUCKETS.map((bucket) => [bucket.key, money(rows.reduce((sum, row) => sum + row[bucket.key], 0))])),
    credits: money(rows.reduce((sum, row) => sum + row.credits, 0)), net: money(rows.reduce((sum, row) => sum + row.net, 0)) };
  return { side: sideKey, asOf, buckets: BUCKETS, rows, totals };
}

// One party's open items, for the aging drill-down and the statement.
export async function getPartyOpenItems(client, context, sideKey, partyIdValue, filters = {}) {
  const config = side(sideKey);
  requirePermission(context, config.permission);
  const asOf = filters.asOf ? isoDate(filters.asOf, "As of") : localToday();
  return openItems(client, context, config, asOf, uuid(partyIdValue, "Party"));
}

// A party's statement between two dates (the financial year so far by default), from the ledger.
export async function getPartyStatement(client, context, sideKey, partyIdValue, filters = {}) {
  const config = side(sideKey);
  requirePermission(context, config.permission);
  const partyId = uuid(partyIdValue, "Party");
  const party = (await client.query(
    `SELECT id, display_name, legal_name, gstin, email, phone, customer_number, code, party_type FROM tenant.business_parties WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, partyId])).rows[0];
  if (!party) throw new AccountingError(404, `That ${config.partyLabel} was not found.`, "ACCOUNTING_PARTY_NOT_FOUND");
  const to = filters.to ? isoDate(filters.to, "To date") : localToday();
  const from = filters.from ? isoDate(filters.from, "From date") : ((await client.query(
    "SELECT start_date::text AS start FROM tenant.accounting_fiscal_years WHERE organization_id = $1 AND $2::date BETWEEN start_date AND end_date LIMIT 1",
    [context.organizationId, to])).rows[0]?.start ?? `${to.slice(0, 4)}-01-01`);
  if (from > to) throw new AccountingError(400, "The start date is after the end date.", "ACCOUNTING_STATEMENT_RANGE", { field: "from" });
  // A receivable statement reads debit as "owed to us"; a payable one reads credit as "we owe".
  const sign = config.controlKind === "receivable" ? 1 : -1;
  const base = `FROM tenant.accounting_journal_lines line
       JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id AND entry.status IN ('posted', 'reversed')
       JOIN tenant.accounting_accounts account ON account.id = line.account_id AND account.control_kind = $3
      WHERE line.organization_id = $1 AND line.party_id = $2`;
  const opening = money((await client.query(`SELECT COALESCE(sum(line.base_debit_amount - line.base_credit_amount), 0) AS amount ${base} AND entry.accounting_date < $4::date`,
    [context.organizationId, partyId, config.controlKind, from])).rows[0].amount) * sign;
  const rows = (await client.query(
    `SELECT entry.id AS entry_id, entry.entry_number, entry.accounting_date, entry.entry_type, entry.source_type, entry.source_id, entry.source_number, entry.reference,
            entry.description AS entry_description, line.description, line.base_debit_amount, line.base_credit_amount,
            (SELECT posting.posting_event FROM tenant.accounting_postings posting WHERE posting.journal_entry_id = entry.id LIMIT 1) AS posting_event
       ${base} AND entry.accounting_date BETWEEN $4::date AND $5::date
      ORDER BY entry.accounting_date, entry.posted_at, entry.entry_number, line.sequence`, [context.organizationId, partyId, config.controlKind, from, to])).rows;
  let running = opening;
  const lines = rows.map((row) => {
    const amount = money((Number(row.base_debit_amount) - Number(row.base_credit_amount)) * sign);
    running = money(running + amount);
    const eventKey = row.posting_event ?? row.source_type ?? (row.entry_type === "reversal" ? "journal_reversal" : "manual_journal");
    return {
      date: isoDate(row.accounting_date), journalEntryId: row.entry_id, journalNumber: row.entry_number,
      document: eventKey === "journal_reversal" ? "Reversal" : postingEventOf(eventKey).label, number: row.source_number ?? row.reference ?? row.entry_number,
      href: row.source_id ? sourceHref(eventKey, row.source_id, row.entry_id) : null, description: row.description || row.entry_description,
      increase: amount > 0 ? amount : 0, decrease: amount < 0 ? -amount : 0, balance: running,
    };
  });
  const open = await openItems(client, context, config, to, partyId);
  const aging = Object.fromEntries([...BUCKETS.map((bucket) => [bucket.key, money(open.filter((item) => item.bucket === bucket.key).reduce((sum, item) => sum + item.amount, 0))]),
    ["credits", money(open.filter((item) => item.bucket === "credit").reduce((sum, item) => sum + item.amount, 0))]]);
  const company = (await client.query(
    "SELECT name, legal_name, tax_id, address_line1, address_line2, city, state_code, postal_code, email, phone FROM public.organizations WHERE id = $1",
    [context.organizationId])).rows[0] ?? null;
  return {
    side: sideKey, from, to,
    party: { id: party.id, name: party.display_name, legalName: party.legal_name, gstin: party.gstin, email: party.email, phone: party.phone, code: party.customer_number ?? party.code ?? null },
    company: company ? {
      name: company.legal_name || company.name, gstin: company.tax_id ?? null, email: company.email ?? null, phone: company.phone ?? null,
      address: [company.address_line1, company.address_line2, [company.city, company.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null,
    } : null,
    opening: money(opening), increases: money(lines.reduce((sum, line) => sum + line.increase, 0)), decreases: money(lines.reduce((sum, line) => sum + line.decrease, 0)),
    closing: money(running), lines, openItems: open, aging,
  };
}
