// TDS deposits, Form 26Q and Form 16A (Procurement report Phase 2, with Accounting). TDS deducted from suppliers — on bills, credit notes
// and advances — sits in "TDS payable (suppliers)" and on the tax ledger (direction withholding, open). Each month's TDS is deposited by
// challan (ITNS 281) by the 7th of the next month (30 April for March): recording the challan books Dr TDS payable (plus any interest or
// late fee to the chosen account), Cr the bank, and marks those tax ledger rows paid against it. The quarter's 26Q is then the deductees
// (PAN, section, amount credited, TDS, date) under their challans; Form 16A is the same, per supplier, for the certificate.
import {
  ACCOUNTING_PERMISSIONS, AccountingError, asDatabaseDecimal, decimal, getAccountMapping, getPrimaryLedger, requirePermission, text, uuid,
} from "./core.js";
import { formatDecimal } from "../../core/decimal.js";
import { createJournalEntry, postJournalEntry, reverseJournalEntry } from "./journals.js";

const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));
const day = (value) => {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  const pad = (number) => String(number).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
};

// The tax ledger rows of supplier TDS with their section, deductee and date of credit or payment.
const ROWS = `
  SELECT ledger.id, ledger.tax_period, ledger.taxable_amount, ledger.tax_amount, ledger.status, ledger.source_type, ledger.source_id, ledger.party_id,
         party.display_name AS party_name, COALESCE(NULLIF(ledger.tax_registration, ''), party.pan) AS pan,
         COALESCE(bill.bill_number, payment.payment_number) AS document_number,
         COALESCE(bill.accounting_date, payment.accounting_date) AS credited_on,
         section.id AS section_id, section.code AS section_code, section.rate AS section_rate,
         deposit.challan_id
    FROM tenant.accounting_tax_ledger ledger
    LEFT JOIN tenant.business_parties party ON party.organization_id = ledger.organization_id AND party.id = ledger.party_id
    LEFT JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = ledger.organization_id AND ledger.source_type IN ('vendor_bill', 'vendor_credit_note') AND bill.id = ledger.source_id
    LEFT JOIN tenant.accounting_vendor_payments payment ON payment.organization_id = ledger.organization_id AND ledger.source_type = 'vendor_payment' AND payment.id = ledger.source_id
    LEFT JOIN tenant.withholding_tax_sections section ON section.organization_id = ledger.organization_id
          AND section.id = COALESCE(bill.withholding_section_id, payment.withholding_section_id)
    LEFT JOIN tenant.accounting_tds_challan_items deposit ON deposit.organization_id = ledger.organization_id AND deposit.tax_ledger_id = ledger.id AND deposit.released_at IS NULL
   WHERE ledger.organization_id = $1 AND ledger.tax_type = 'tds' AND ledger.direction = 'withholding' AND ledger.source_type IN ('vendor_bill', 'vendor_credit_note', 'vendor_payment')`;

// Due date to deposit a month's TDS: the 7th of the next month; March's by 30 April.
export function tdsDepositDue(period) {
  const [year, month] = String(period).split("-").map(Number);
  if (month === 3) return `${year}-04-30`;
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  return `${next.y}-${String(next.m).padStart(2, "0")}-07`;
}

// Financial year (starting April) and quarter of a YYYY-MM period.
export function quarterOf(period) {
  const [year, month] = String(period).split("-").map(Number);
  const fy = month >= 4 ? year : year - 1;
  return { fy, quarter: month >= 4 && month <= 6 ? 1 : month <= 9 && month >= 7 ? 2 : month >= 10 ? 3 : 4 };
}
const quarterMonths = (fy, quarter) => (quarter === 4 ? [1, 2, 3].map((m) => `${fy + 1}-0${m}`) : [1, 2, 3].map((index) => {
  const month = (quarter - 1) * 3 + 3 + index;
  return `${fy}-${String(month).padStart(2, "0")}`;
}));
// When the quarter's 26Q is due: 31 July, 31 October, 31 January, 31 May.
export const form26QDue = (fy, quarter) => ({ 1: `${fy}-07-31`, 2: `${fy}-10-31`, 3: `${fy + 1}-01-31`, 4: `${fy + 1}-05-31` })[quarter];

const view = (row) => ({
  id: row.id, period: row.tax_period, sourceType: row.source_type, sourceId: row.source_id, documentNumber: row.document_number, creditedOn: day(row.credited_on),
  partyId: row.party_id, partyName: row.party_name, pan: row.pan ?? null, sectionCode: row.section_code ?? null, sectionRate: dec(row.section_rate),
  taxable: dec(row.taxable_amount), tds: dec(row.tax_amount), status: row.status, challanId: row.challan_id ?? null,
});

// listTdsToDeposit: open supplier TDS, by month and section, with the deposit due date. filters: { period? (YYYY-MM) }.
export async function listTdsToDeposit(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId];
  let where = " AND ledger.status = 'open'";
  if (/^\d{4}-\d{2}$/.test(filters.period ?? "")) { values.push(filters.period); where += ` AND ledger.tax_period = $${values.length}`; }
  const rows = (await client.query(`${ROWS}${where} ORDER BY ledger.tax_period, section.code, credited_on`, values)).rows.map(view);
  const today = (await client.query(`SELECT (now() AT TIME ZONE COALESCE(NULLIF(timezone, ''), 'Asia/Kolkata'))::date::text AS d FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0].d;
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.period}:${row.sectionCode ?? "—"}`;
    if (!groups.has(key)) groups.set(key, { period: row.period, sectionCode: row.sectionCode, dueDate: tdsDepositDue(row.period), count: 0, taxable: 0n, tds: 0n, rowIds: [], missingPan: 0 });
    const group = groups.get(key);
    group.count += 1; group.taxable += decimal(row.taxable); group.tds += decimal(row.tds); group.rowIds.push(row.id);
    if (!row.pan) group.missingPan += 1;
  }
  return {
    today,
    groups: [...groups.values()].map((group) => ({ ...group, taxable: dec(group.taxable), tds: dec(group.tds), overdue: group.dueDate < today })),
    rows,
  };
}

// recordTdsDeposit: one challan for the chosen open TDS rows.
// input: { taxLedgerIds: [...], depositDate, bsrCode (7 digits), challanSerial (5 digits), interest?, fee?, extraAccountId? (for interest and fee), bankAccountId?, notes? }
export async function recordTdsDeposit(client, context, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.taxManage);
  const ids = Array.isArray(input.taxLedgerIds) ? input.taxLedgerIds.map((id) => uuid(id, "TDS row")) : [];
  if (!ids.length) throw new AccountingError(400, "Choose the TDS to deposit.");
  const depositDate = /^\d{4}-\d{2}-\d{2}$/.test(input.depositDate ?? "") ? input.depositDate : null;
  if (!depositDate) throw new AccountingError(400, "Enter the date the challan was paid.");
  const companyToday = (await client.query(`SELECT (now() AT TIME ZONE COALESCE(NULLIF(timezone, ''), 'Asia/Kolkata'))::date::text AS d FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0].d;
  if (depositDate > companyToday) throw new AccountingError(400, "The challan date cannot be in the future.");
  const bsrCode = String(input.bsrCode ?? "").trim();
  if (!/^\d{7}$/.test(bsrCode)) throw new AccountingError(400, "The BSR code is the bank branch's 7 digits on the challan.");
  const challanSerial = String(input.challanSerial ?? "").trim();
  if (!/^\d{1,5}$/.test(challanSerial)) throw new AccountingError(400, "The challan serial number is up to 5 digits.");
  const interest = decimal(String(input.interest ?? "0").trim() || "0");
  const fee = decimal(String(input.fee ?? "0").trim() || "0");
  if (interest < 0n || fee < 0n) throw new AccountingError(400, "Interest and fee are zero or more.");
  const rows = (await client.query(`SELECT id, tax_amount, status, tax_period FROM tenant.accounting_tax_ledger WHERE organization_id = $1 AND id = ANY($2::uuid[]) AND tax_type = 'tds'
      AND direction = 'withholding' FOR UPDATE`, [context.organizationId, ids])).rows;
  if (rows.length !== ids.length || rows.some((row) => row.status !== "open")) throw new AccountingError(409, "Some of the TDS chosen is no longer waiting to be deposited. Refresh and choose again.");
  const tax = rows.reduce((sum, row) => sum + decimal(row.tax_amount), 0n);
  if (tax <= 0n) throw new AccountingError(409, "The TDS chosen adds up to nothing to deposit.");
  const ledger = await getPrimaryLedger(client, context);
  const bank = input.bankAccountId
    ? (await client.query(`SELECT bank.gl_account_id, journal.id AS journal_id FROM tenant.accounting_bank_accounts bank LEFT JOIN tenant.accounting_journals journal ON journal.organization_id = bank.organization_id
          AND journal.ledger_id = bank.ledger_id AND journal.journal_type = 'bank' AND journal.status = 'active' WHERE bank.organization_id = $1 AND bank.ledger_id = $2 AND bank.id = $3 AND bank.status = 'active'
          ORDER BY journal.created_at LIMIT 1`, [context.organizationId, ledger.id, uuid(input.bankAccountId, "Bank account")])).rows[0]
    : { gl_account_id: (await getAccountMapping(client, context, ledger.id, "bank", {})).account_id,
      journal_id: (await client.query(`SELECT id FROM tenant.accounting_journals WHERE organization_id = $1 AND ledger_id = $2 AND journal_type = 'bank' AND status = 'active' ORDER BY created_at LIMIT 1`,
        [context.organizationId, ledger.id])).rows[0]?.id };
  if (!bank?.journal_id) throw new AccountingError(409, "A bank journal is not configured for the bank account.");
  const payable = await getAccountMapping(client, context, ledger.id, "withholding_tax", { date: depositDate });
  const extraAccountId = interest + fee > 0n ? uuid(input.extraAccountId, "Account for interest and fee") : null;
  const currency = (await client.query(`SELECT btrim(base_currency) AS code FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0]?.code || "INR";
  const challan = (await client.query(
    `INSERT INTO tenant.accounting_tds_challans (organization_id, deposit_date, bsr_code, challan_serial, tax_amount, interest_amount, fee_amount, bank_account_id, extra_account_id, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [context.organizationId, depositDate, bsrCode, challanSerial.padStart(5, "0"), asDatabaseDecimal(tax), asDatabaseDecimal(interest), asDatabaseDecimal(fee), input.bankAccountId ?? null,
      extraAccountId, text(input.notes, 500) || null, context.userId])).rows[0];
  const reference = `TDS challan ${bsrCode}/${challan.challan_serial}`;
  const lines = [
    { accountId: payable.account_id, description: `${reference}: TDS deposited`, debit: asDatabaseDecimal(tax), credit: 0, referenceType: "tds_challan", referenceId: challan.id },
    ...(interest + fee > 0n ? [{ accountId: extraAccountId, description: `${reference}: interest and fee`, debit: asDatabaseDecimal(interest + fee), credit: 0, referenceType: "tds_challan", referenceId: challan.id }] : []),
    { accountId: bank.gl_account_id, description: reference, debit: 0, credit: asDatabaseDecimal(tax + interest + fee), referenceType: "tds_challan", referenceId: challan.id },
  ];
  const journal = await createJournalEntry(client, context, { ledgerId: ledger.id, journalId: bank.journal_id, entryDate: depositDate, accountingDate: depositDate, documentDate: depositDate,
    entryType: "subledger", reference, description: reference, currencyCode: currency, exchangeRate: "1", lines },
  { internal: true, sourceModule: "accounting", sourceType: "tds_challan", sourceId: challan.id, sourceNumber: reference });
  await postJournalEntry(client, context, journal.entry.id, { internal: true, allowDraft: true });
  await client.query(`UPDATE tenant.accounting_tds_challans SET journal_entry_id = $3 WHERE organization_id = $1 AND id = $2`, [context.organizationId, challan.id, journal.entry.id]);
  for (const row of rows) {
    await client.query(`INSERT INTO tenant.accounting_tds_challan_items (organization_id, challan_id, tax_ledger_id, amount) VALUES ($1, $2, $3, $4)`,
      [context.organizationId, challan.id, row.id, row.tax_amount]);
    await client.query(`UPDATE tenant.accounting_tax_ledger SET status = 'paid' WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id]);
  }
  return { id: challan.id, reference, tax: dec(tax), total: dec(tax + interest + fee), rows: rows.length, journalEntryId: journal.entry.id };
}

// cancelTdsDeposit: a challan recorded by mistake. Its journal is reversed and its TDS waits to be deposited again.
export async function cancelTdsDeposit(client, context, challanId, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.taxManage);
  const challan = (await client.query(`SELECT * FROM tenant.accounting_tds_challans WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, uuid(challanId, "Challan")])).rows[0];
  if (!challan) throw new AccountingError(404, "Challan not found.");
  if (challan.status === "cancelled") return { id: challan.id, status: "cancelled" };
  const reason = text(input.reason, 500);
  if (!reason || reason.length < 3) throw new AccountingError(400, "Give the reason for cancelling the challan.");
  // The reversal is dated today, or the challan's date if that is later.
  const today = (await client.query(`SELECT (now() AT TIME ZONE COALESCE(NULLIF(timezone, ''), 'Asia/Kolkata'))::date::text AS d FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0].d;
  const reversalDate = day(challan.deposit_date) > today ? day(challan.deposit_date) : today;
  if (challan.journal_entry_id) await reverseJournalEntry(client, { ...context, permissions: [...new Set([...(context.permissions ?? []), "accounting.journal.reverse"])] }, challan.journal_entry_id,
    { reason, accountingDate: reversalDate });
  const items = (await client.query(`UPDATE tenant.accounting_tds_challan_items SET released_at = now() WHERE organization_id = $1 AND challan_id = $2 AND released_at IS NULL RETURNING tax_ledger_id`,
    [context.organizationId, challan.id])).rows;
  for (const item of items) await client.query(`UPDATE tenant.accounting_tax_ledger SET status = 'open' WHERE organization_id = $1 AND id = $2 AND status = 'paid'`, [context.organizationId, item.tax_ledger_id]);
  await client.query(`UPDATE tenant.accounting_tds_challans SET status = 'cancelled', cancel_reason = $3, cancelled_at = now(), cancelled_by = $4 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, challan.id, reason, context.userId]);
  return { id: challan.id, status: "cancelled" };
}

const challanView = (row) => ({
  id: row.id, depositDate: day(row.deposit_date), bsrCode: row.bsr_code, challanSerial: row.challan_serial, tax: dec(row.tax_amount), interest: dec(row.interest_amount), fee: dec(row.fee_amount),
  total: dec(decimal(row.tax_amount) + decimal(row.interest_amount) + decimal(row.fee_amount)), status: row.status, cancelReason: row.cancel_reason ?? null, rows: Number(row.rows ?? 0),
  journalEntryId: row.journal_entry_id,
});

// listTdsDeposits: the challans of a financial year (default: the current one).
export async function listTdsDeposits(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const fy = Number(filters.fy) || quarterOf(new Date().toISOString().slice(0, 7)).fy;
  const rows = (await client.query(
    `SELECT challan.*, (SELECT count(*) FROM tenant.accounting_tds_challan_items item WHERE item.organization_id = challan.organization_id AND item.challan_id = challan.id) AS rows
       FROM tenant.accounting_tds_challans challan WHERE challan.organization_id = $1 AND challan.deposit_date BETWEEN $2::date AND $3::date ORDER BY challan.deposit_date DESC, challan.created_at DESC`,
    [context.organizationId, `${fy}-04-01`, `${fy + 1}-05-31`])).rows;
  return { fy, rows: rows.map(challanView) };
}

// form26QData: the quarter's return data — the challans that deposited its TDS and each deductee row under its challan — and what stops
// the return: TDS not yet deposited, a deductee without a PAN (206AA rate applies), a row without a section.
export async function form26QData(client, context, { fy, quarter, partyId = null } = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const year = Number(fy);
  const q = Number(quarter);
  if (!Number.isInteger(year) || ![1, 2, 3, 4].includes(q)) throw new AccountingError(400, "Choose the financial year and quarter.");
  const months = quarterMonths(year, q);
  const values = [context.organizationId, months];
  let where = " AND ledger.tax_period = ANY($2::text[]) AND ledger.status IN ('open', 'paid', 'reported')";
  if (partyId) { values.push(uuid(partyId, "Supplier")); where += ` AND ledger.party_id = $${values.length}`; }
  const rows = (await client.query(`${ROWS}${where} ORDER BY credited_on, document_number`, values)).rows.map(view);
  const challanIds = [...new Set(rows.map((row) => row.challanId).filter(Boolean))];
  const challans = challanIds.length ? (await client.query(
    `SELECT challan.*, (SELECT count(*) FROM tenant.accounting_tds_challan_items item WHERE item.organization_id = challan.organization_id AND item.challan_id = challan.id) AS rows
       FROM tenant.accounting_tds_challans challan WHERE challan.organization_id = $1 AND challan.id = ANY($2::uuid[]) ORDER BY challan.deposit_date`, [context.organizationId, challanIds])).rows.map(challanView) : [];
  const byChallan = new Map(challans.map((challan) => [challan.id, challan]));
  const deductees = rows.map((row) => {
    const challan = row.challanId ? byChallan.get(row.challanId) : null;
    return { ...row, deducteeCode: row.pan && row.pan[3] === "C" ? "01" : "02", challan: challan ? { bsrCode: challan.bsrCode, serial: challan.challanSerial, date: challan.depositDate } : null };
  });
  const problems = [];
  const undeposited = deductees.filter((row) => !row.challan);
  if (undeposited.length) problems.push(`${undeposited.length} TDS row${undeposited.length === 1 ? " is" : "s are"} not deposited yet.`);
  const noPan = deductees.filter((row) => !row.pan);
  if (noPan.length) problems.push(`${noPan.length} deductee${noPan.length === 1 ? " has" : "s have"} no PAN: the higher rate (206AA) applies and the return shows PANNOTAVBL.`);
  const noSection = deductees.filter((row) => !row.sectionCode);
  if (noSection.length) problems.push(`${noSection.length} row${noSection.length === 1 ? " has" : "s have"} no TDS section.`);
  const total = deductees.reduce((sum, row) => sum + decimal(row.tds), 0n);
  return { fy: year, quarter: q, months, dueDate: form26QDue(year, q), challans, deductees, total: dec(total), problems };
}

// The quarter as a CSV in the order the return preparation utility asks for, one deductee row per line under its challan.
export async function form26QCsv(client, context, input = {}) {
  const data = await form26QData(client, context, input);
  const quote = (value) => { const textValue = String(value ?? ""); return /[",\n]/.test(textValue) ? `"${textValue.replace(/"/g, '""')}"` : textValue; };
  const header = ["Challan BSR code", "Challan date", "Challan serial", "Section", "Deductee code", "PAN", "Deductee name", "Date of payment or credit", "Amount paid or credited",
    "TDS", "Rate (%)", "Document"];
  const lines = data.deductees.map((row) => [row.challan?.bsrCode ?? "", row.challan?.date ?? "", row.challan?.serial ?? "", row.sectionCode ?? "", row.deducteeCode, row.pan ?? "PANNOTAVBL",
    row.partyName ?? "", row.creditedOn ?? "", row.taxable, row.tds, row.sectionRate ?? "", row.documentNumber ?? ""].map(quote).join(","));
  return { fileName: `26Q-FY${data.fy}-${String(data.fy + 1).slice(2)}-Q${data.quarter}.csv`, content: [header.join(","), ...lines].join("\r\n"), problems: data.problems };
}

// Form 16A details for one supplier and quarter: what was credited, the TDS and the challans it was deposited under.
export async function form16AData(client, context, { partyId, fy, quarter }) {
  const data = await form26QData(client, context, { fy, quarter, partyId });
  const party = (await client.query(`SELECT display_name, legal_name, pan FROM tenant.business_parties WHERE organization_id = $1 AND id = $2`, [context.organizationId, uuid(partyId, "Supplier")])).rows[0];
  const credited = data.deductees.reduce((sum, row) => sum + decimal(row.taxable), 0n);
  return { ...data, deductee: { name: party?.legal_name || party?.display_name || null, pan: party?.pan ?? null }, credited: dec(credited) };
}
