// The financial statements (Finance MVP F8), all from posted entries of the primary ledger and each checking itself: a statement that does
// not add up says so (an exception with the difference) instead of showing an invented total.
//
//   trial balance   every account: balance before the period, the period's debits and credits, balance at its end. Opening, period and
//                   closing debits each equal their credits.
//   profit & loss   revenue − cost of sales = gross profit; − operating expenses = operating profit; + other income − other expenses =
//                   net profit, for the period (year-end closing entries left out), with a comparison period.
//   balance sheet   assets = liabilities + equity at a date. Profit not yet closed into retained earnings is shown as equity: this year's
//                   profit to date, and earlier years' results not closed yet. Suspense balances are flagged.
//   cash flow       indirect method: net profit, non-cash items (depreciation, gain or loss on selling assets), working-capital changes,
//                   investing and financing movements — from the change in every balance-sheet account, so moving money between the
//                   company's own accounts (bank to bank, cash deposits, funds in transit) is not a cash flow. Opening cash + net change
//                   must equal closing cash.
import { ACCOUNTING_PERMISSIONS, AccountingError, decimal, isoDate, requirePermission } from "../core.js";
import { localToday } from "../journals.js";
import { accountBalances, cashAccountIds, financialYearOf, mappedAccountIds, statementPeriod, sumOf, toMoney } from "./ledger-balances.js";

const fail = (status, message, code, field) => { throw new AccountingError(status, message, code, field ? { field } : undefined); };
const ZERO = 0n;
const line = (account, amount, extra = {}) => ({ accountId: account.id, code: account.code, name: account.name, amount: toMoney(amount), ...extra });

// ================================================================== trial balance
export async function getTrialBalanceStatement(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.reportsView);
  const period = await statementPeriod(client, context, filters);
  const all = await accountBalances(client, context, period);
  const showZero = filters.showZero === true || filters.showZero === "true";
  const rows = all.filter((row) => showZero ? row.status === "active" || row.opening !== ZERO || row.closing !== ZERO || row.debit !== ZERO
    : row.opening !== ZERO || row.debit !== ZERO || row.credit !== ZERO || row.closing !== ZERO);
  const dr = (value) => (value > ZERO ? value : ZERO);
  const cr = (value) => (value < ZERO ? -value : ZERO);
  const totals = {
    openingDebit: sumOf(rows, (row) => dr(row.opening)), openingCredit: sumOf(rows, (row) => cr(row.opening)),
    debit: sumOf(rows, (row) => row.debit), credit: sumOf(rows, (row) => row.credit),
    closingDebit: sumOf(rows, (row) => dr(row.closing)), closingCredit: sumOf(rows, (row) => cr(row.closing)),
  };
  const exceptions = [];
  if (totals.openingDebit !== totals.openingCredit) exceptions.push(`Opening debits ${toMoney(totals.openingDebit)} and credits ${toMoney(totals.openingCredit)} differ by ${toMoney(totals.openingDebit - totals.openingCredit)}.`);
  if (totals.debit !== totals.credit) exceptions.push(`The period's debits ${toMoney(totals.debit)} and credits ${toMoney(totals.credit)} differ by ${toMoney(totals.debit - totals.credit)}.`);
  if (totals.closingDebit !== totals.closingCredit) exceptions.push(`Closing debits ${toMoney(totals.closingDebit)} and credits ${toMoney(totals.closingCredit)} differ by ${toMoney(totals.closingDebit - totals.closingCredit)}.`);
  return {
    ...period,
    rows: rows.map((row) => ({
      accountId: row.id, code: row.code, name: row.name, accountClass: row.accountClass, accountType: row.accountType, group: row.group,
      openingDebit: toMoney(dr(row.opening)), openingCredit: toMoney(cr(row.opening)), debit: toMoney(row.debit), credit: toMoney(row.credit),
      closingDebit: toMoney(dr(row.closing)), closingCredit: toMoney(cr(row.closing)),
    })),
    totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, toMoney(value)])),
    balanced: exceptions.length === 0, exceptions,
  };
}

// ================================================================== profit and loss
const PL_SECTIONS = [
  { key: "revenue", label: "Revenue", types: ["revenue"], sign: -1n },
  { key: "costOfSales", label: "Cost of sales", types: ["cogs"], sign: 1n },
  { key: "operatingExpenses", label: "Operating expenses", types: ["expense", "rounding"], sign: 1n },
  { key: "otherIncome", label: "Other income", types: ["other_income", "fx_gain"], sign: -1n },
  { key: "otherExpenses", label: "Other expenses", types: ["other_expense", "fx_loss"], sign: 1n },
];

async function profitAndLossOf(client, context, period) {
  const rows = (await accountBalances(client, context, period, { excludeClosing: true })).filter((row) => ["revenue", "expense"].includes(row.accountClass));
  const sections = {};
  for (const section of PL_SECTIONS) {
    const lines = rows.filter((row) => section.types.includes(row.accountType)).map((row) => ({ row, amount: section.sign * (row.debit - row.credit) }))
      .filter((entry) => entry.amount !== ZERO);
    sections[section.key] = { label: section.label, lines, total: sumOf(lines, (entry) => entry.amount) };
  }
  // An account whose type isn't one of the above still counts (as an operating expense or other income), so nothing goes missing.
  const known = new Set(PL_SECTIONS.flatMap((section) => section.types));
  for (const row of rows.filter((entry) => !known.has(entry.accountType))) {
    const target = row.accountClass === "revenue" ? sections.otherIncome : sections.operatingExpenses;
    const amount = (row.accountClass === "revenue" ? -1n : 1n) * (row.debit - row.credit);
    if (amount !== ZERO) { target.lines.push({ row, amount }); target.total += amount; }
  }
  const grossProfit = sections.revenue.total - sections.costOfSales.total;
  const operatingProfit = grossProfit - sections.operatingExpenses.total;
  const netProfit = operatingProfit + sections.otherIncome.total - sections.otherExpenses.total;
  // Cross-check: net profit equals the plain sum of every revenue and expense line (credit-positive).
  const plain = -sumOf(rows, (row) => row.debit - row.credit);
  return { sections, grossProfit, operatingProfit, netProfit, plain };
}

const previousPeriod = (from, to, mode) => {
  const shift = (iso, { days = 0, years = 0 }) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() + years); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  if (mode === "previous_year") return { from: shift(from, { years: -1 }), to: shift(to, { years: -1 }) };
  const length = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  return { from: shift(from, { days: -length }), to: shift(from, { days: -1 }) };
};

export async function getProfitAndLossStatement(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.reportsView);
  const period = await statementPeriod(client, context, filters);
  const current = await profitAndLossOf(client, context, period);
  const compareMode = ["previous_period", "previous_year"].includes(filters.compare) ? filters.compare : null;
  const comparePeriod = compareMode ? previousPeriod(period.from, period.to, compareMode) : null;
  const before = comparePeriod ? await profitAndLossOf(client, context, comparePeriod) : null;
  const sectionView = (key) => {
    const ids = new Map();
    for (const entry of current.sections[key].lines) ids.set(entry.row.id, { row: entry.row, amount: entry.amount, compare: ZERO });
    for (const entry of before?.sections[key].lines ?? []) {
      const existing = ids.get(entry.row.id);
      if (existing) existing.compare = entry.amount; else ids.set(entry.row.id, { row: entry.row, amount: ZERO, compare: entry.amount });
    }
    return {
      key, label: current.sections[key].label, total: toMoney(current.sections[key].total), compareTotal: before ? toMoney(before.sections[key].total) : null,
      lines: [...ids.values()].sort((a, b) => a.row.code.localeCompare(b.row.code)).map((entry) => line(entry.row, entry.amount, { compare: before ? toMoney(entry.compare) : null })),
    };
  };
  const exceptions = [];
  if (current.netProfit !== current.plain) exceptions.push(`The sections add up to ${toMoney(current.netProfit)} but the accounts to ${toMoney(current.plain)}.`);
  return {
    ...period, compare: comparePeriod ? { ...comparePeriod, mode: compareMode } : null,
    sections: PL_SECTIONS.map((section) => sectionView(section.key)),
    grossProfit: toMoney(current.grossProfit), operatingProfit: toMoney(current.operatingProfit), netProfit: toMoney(current.netProfit),
    compareTotals: before ? { grossProfit: toMoney(before.grossProfit), operatingProfit: toMoney(before.operatingProfit), netProfit: toMoney(before.netProfit) } : null,
    exceptions, balanced: exceptions.length === 0,
  };
}

// ================================================================== balance sheet
const BS_GROUPS = [
  { key: "cash", side: "assets", label: "Cash and bank" },
  { key: "receivables", side: "assets", label: "Trade receivables", types: ["receivable"] },
  { key: "inventory", side: "assets", label: "Inventory", types: ["inventory"] },
  { key: "taxInput", side: "assets", label: "Input tax (GST) receivable", types: ["tax_input"] },
  { key: "otherCurrentAssets", side: "assets", label: "Other current assets", types: ["current_asset"] },
  { key: "fixedAssets", side: "assets", label: "Fixed assets (net of depreciation)", types: ["fixed_asset", "accumulated_depreciation"] },
  { key: "otherNonCurrentAssets", side: "assets", label: "Other non-current assets", types: ["non_current_asset"] },
  { key: "payables", side: "liabilities", label: "Trade payables", types: ["payable"] },
  { key: "taxOutput", side: "liabilities", label: "Taxes payable (GST, TDS)", types: ["tax_output"] },
  { key: "otherCurrentLiabilities", side: "liabilities", label: "Other current liabilities", types: ["current_liability"] },
  { key: "nonCurrentLiabilities", side: "liabilities", label: "Long-term liabilities", types: ["non_current_liability"] },
  { key: "suspense", side: "either", label: "Suspense and clearing", types: ["suspense"] },
  { key: "equity", side: "equity", label: "Capital and reserves", types: ["equity", "retained_earnings"] },
];

async function balanceSheetOf(client, context, asOf) {
  const rows = await accountBalances(client, context, { from: null, to: asOf });
  const cash = await cashAccountIds(client, context);
  const groups = Object.fromEntries(BS_GROUPS.map((group) => [group.key, { ...group, lines: [], total: ZERO }]));
  const add = (key, row, amount) => { if (amount === ZERO) return; groups[key].lines.push({ row, amount }); groups[key].total += amount; };
  for (const row of rows.filter((entry) => ["asset", "liability", "equity"].includes(entry.accountClass))) {
    const balance = row.closing; // debit-positive
    if (cash.has(row.id)) { add("cash", row, balance); continue; }
    const group = BS_GROUPS.find((entry) => entry.types?.includes(row.accountType));
    if (row.accountType === "suspense") { add("suspense", row, row.accountClass === "asset" ? balance : -balance); continue; }
    if (group && group.side === "assets") add(group.key, row, balance);
    else if (group) add(group.key, row, -balance);
    else if (row.accountClass === "asset") add("otherCurrentAssets", row, balance);
    else if (row.accountClass === "liability") add("otherCurrentLiabilities", row, -balance);
    else add("equity", row, -balance);
  }
  // Profit not yet closed into retained earnings: the cumulative revenue and expense balances (credit-positive), split into this
  // financial year's profit to date and earlier years' results.
  const year = await financialYearOf(client, context, asOf);
  const pl = rows.filter((entry) => ["revenue", "expense"].includes(entry.accountClass));
  const unclosed = -sumOf(pl, (entry) => entry.closing);
  const yearProfit = year ? (await profitAndLossOf(client, context, { from: year.start, to: asOf })).netProfit : unclosed;
  const earlier = unclosed - yearProfit;
  const suspenseNet = groups.suspense.total; // asset-side positive
  const assets = BS_GROUPS.filter((group) => group.side === "assets").reduce((total, group) => total + groups[group.key].total, ZERO) + (suspenseNet > ZERO ? suspenseNet : ZERO);
  const liabilities = BS_GROUPS.filter((group) => group.side === "liabilities").reduce((total, group) => total + groups[group.key].total, ZERO) + (suspenseNet < ZERO ? -suspenseNet : ZERO);
  const equity = groups.equity.total + yearProfit + earlier;
  return { groups, year, yearProfit, earlier, assets, liabilities, equity };
}

export async function getBalanceSheetStatement(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.reportsView);
  const asOf = filters.asOf ? isoDate(filters.asOf, "As of") : localToday();
  const compareTo = filters.compareTo ? isoDate(filters.compareTo, "Compare with") : null;
  if (compareTo && compareTo >= asOf) fail(400, "Compare with an earlier date.", "ACCOUNTING_STATEMENT_PERIOD_INVALID", "compareTo");
  const now = await balanceSheetOf(client, context, asOf);
  const then = compareTo ? await balanceSheetOf(client, context, compareTo) : null;
  const groupView = (key) => {
    const merged = new Map();
    for (const entry of now.groups[key].lines) merged.set(entry.row.id, { row: entry.row, amount: entry.amount, compare: ZERO });
    for (const entry of then?.groups[key].lines ?? []) {
      const existing = merged.get(entry.row.id);
      if (existing) existing.compare = entry.amount; else merged.set(entry.row.id, { row: entry.row, amount: ZERO, compare: entry.amount });
    }
    return { key, label: now.groups[key].label, total: toMoney(now.groups[key].total), compareTotal: then ? toMoney(then.groups[key].total) : null,
      lines: [...merged.values()].sort((a, b) => a.row.code.localeCompare(b.row.code)).map((entry) => line(entry.row, entry.amount, { compare: then ? toMoney(entry.compare) : null })) };
  };
  const section = (side) => BS_GROUPS.filter((group) => group.side === side).map((group) => groupView(group.key)).filter((group) => group.lines.length > 0 || group.total !== 0);
  const exceptions = [];
  const difference = now.assets - now.liabilities - now.equity;
  if (difference !== ZERO) exceptions.push(`Assets and liabilities + equity differ by ${toMoney(difference)}.`);
  if (now.groups.suspense.total !== ZERO) exceptions.push(`Suspense and clearing accounts hold ${toMoney(now.groups.suspense.total)}; clear them before relying on this balance sheet.`);
  const equityExtras = [
    ...(now.yearProfit !== ZERO || (then && then.yearProfit !== ZERO) ? [{ key: "yearProfit", label: now.year ? `Profit for ${now.year.name} to date` : "Profit to date", amount: toMoney(now.yearProfit), compare: then ? toMoney(then.yearProfit) : null }] : []),
    ...(now.earlier !== ZERO || (then && then.earlier !== ZERO) ? [{ key: "earlier", label: "Earlier years' results not yet closed", amount: toMoney(now.earlier), compare: then ? toMoney(then.earlier) : null }] : []),
  ];
  return {
    asOf, compareTo, year: now.year,
    assets: section("assets"), liabilities: section("liabilities"), suspense: now.groups.suspense.lines.length ? groupView("suspense") : null,
    equity: { ...groupView("equity"), extras: equityExtras },
    totals: { assets: toMoney(now.assets), liabilities: toMoney(now.liabilities), equity: toMoney(now.equity), liabilitiesAndEquity: toMoney(now.liabilities + now.equity) },
    compareTotals: then ? { assets: toMoney(then.assets), liabilities: toMoney(then.liabilities), equity: toMoney(then.equity), liabilitiesAndEquity: toMoney(then.liabilities + then.equity) } : null,
    balanced: difference === ZERO, exceptions,
  };
}

// ================================================================== cash flow (indirect)
const WORKING_CAPITAL = [
  { key: "receivables", label: "Trade receivables", types: ["receivable"] },
  { key: "inventory", label: "Inventory", types: ["inventory"] },
  { key: "taxInput", label: "Input tax (GST) receivable", types: ["tax_input"] },
  { key: "otherCurrentAssets", label: "Other current assets", types: ["current_asset"] },
  { key: "payables", label: "Trade payables", types: ["payable"] },
  { key: "taxOutput", label: "Taxes payable", types: ["tax_output"] },
  { key: "otherCurrentLiabilities", label: "Other current liabilities", types: ["current_liability"] },
  { key: "suspense", label: "Suspense and clearing", types: ["suspense"] },
];

export async function getCashFlowStatement(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.reportsView);
  const period = await statementPeriod(client, context, filters);
  // Year-end closing entries move profit to retained earnings without cash; they are left out of every figure here.
  const rows = await accountBalances(client, context, period, { excludeClosing: true });
  const cash = await cashAccountIds(client, context);
  const disposal = await mappedAccountIds(client, context, ["asset_disposal_gain", "asset_disposal_loss"]);
  const movement = (row) => row.debit - row.credit; // debit-positive change in the period
  const pl = rows.filter((row) => ["revenue", "expense"].includes(row.accountClass));
  const netProfit = -sumOf(pl, movement);
  // Depreciation: what accumulated depreciation grew by, apart from disposals (a disposal releases it).
  const depreciation = await depreciationOf(client, context, period, rows.filter((row) => row.accountType === "accumulated_depreciation").map((row) => row.id));
  const netGainOnDisposal = -sumOf(pl.filter((row) => disposal.has(row.id)), movement);
  // Working capital: an asset that grew used cash ("Increase in …", negative); a liability that grew provided it ("Increase in …", positive).
  const liabilityGroups = new Set(["payables", "taxOutput", "otherCurrentLiabilities"]);
  const working = WORKING_CAPITAL.map((group) => {
    const members = rows.filter((row) => !cash.has(row.id) && group.types.includes(row.accountType) && ["asset", "liability"].includes(row.accountClass));
    const amount = -sumOf(members, movement);
    const grew = liabilityGroups.has(group.key) ? amount > ZERO : amount < ZERO;
    return { key: group.key, label: `${grew ? "Increase" : "Decrease"} in ${group.label.toLowerCase()}`, amount };
  });
  const operatingItems = [
    { key: "depreciation", label: "Depreciation (no cash)", amount: depreciation },
    { key: "disposal", label: "(Gain) / loss on selling assets", amount: -netGainOnDisposal },
    ...working,
  ];
  const operating = netProfit + sumOf(operatingItems, (item) => item.amount);
  // Investing: fixed assets bought and sold — the change in their net book value, depreciation and the disposal result taken back out.
  const fixed = rows.filter((row) => ["fixed_asset", "accumulated_depreciation"].includes(row.accountType));
  const otherNonCurrent = rows.filter((row) => row.accountType === "non_current_asset" && !cash.has(row.id));
  const investingItems = [
    { key: "fixedAssets", label: "Fixed assets bought and sold (net)", amount: -sumOf(fixed, movement) - depreciation + netGainOnDisposal },
    { key: "otherNonCurrent", label: "Other non-current assets", amount: -sumOf(otherNonCurrent, movement) },
  ];
  const investing = sumOf(investingItems, (item) => item.amount);
  const borrowings = rows.filter((row) => row.accountType === "non_current_liability");
  const equityRows = rows.filter((row) => row.accountClass === "equity");
  const financingItems = [
    { key: "borrowings", label: "Long-term borrowings (net)", amount: -sumOf(borrowings, movement) },
    { key: "equity", label: "Capital introduced / withdrawn", amount: -sumOf(equityRows, movement) },
  ];
  const financing = sumOf(financingItems, (item) => item.amount);
  const cashRows = rows.filter((row) => cash.has(row.id));
  const opening = sumOf(cashRows, (row) => row.opening);
  const closing = sumOf(cashRows, (row) => row.closing);
  const netChange = operating + investing + financing;
  const exceptions = [];
  if (opening + netChange !== closing)
    exceptions.push(`Opening cash ${toMoney(opening)} + the net change ${toMoney(netChange)} doesn't reach closing cash ${toMoney(closing)}: ${toMoney(closing - opening - netChange)} isn't explained. Check the trial balance is balanced.`);
  const view = (items) => items.filter((item) => item.amount !== ZERO).map((item) => ({ key: item.key, label: item.label, amount: toMoney(item.amount) }));
  return {
    ...period,
    operating: { netProfit: toMoney(netProfit), items: view(operatingItems), total: toMoney(operating) },
    investing: { items: view(investingItems), total: toMoney(investing) },
    financing: { items: view(financingItems), total: toMoney(financing) },
    netChange: toMoney(netChange), openingCash: toMoney(opening), closingCash: toMoney(closing),
    cashAccounts: cashRows.filter((row) => row.opening !== ZERO || row.closing !== ZERO).map((row) => ({ accountId: row.id, code: row.code, name: row.name, opening: toMoney(row.opening), closing: toMoney(row.closing) })),
    balanced: exceptions.length === 0, exceptions,
  };
}

async function depreciationOf(client, context, period, accountIds) {
  if (!accountIds.length) return ZERO;
  const row = (await client.query(
    `SELECT COALESCE(sum(line.base_credit_amount - line.base_debit_amount), 0)::text AS amount
       FROM tenant.accounting_journal_lines line JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id
      WHERE line.organization_id = $1 AND line.account_id = ANY($2::uuid[]) AND entry.status IN ('posted', 'reversed')
        AND entry.accounting_date BETWEEN $3::date AND $4::date AND COALESCE(entry.source_type, '') NOT LIKE 'asset_disposal%'
        AND NOT (entry.entry_type = 'closing' AND entry.source_type = 'year_end_close')`,
    [context.organizationId, accountIds, period.from, period.to])).rows[0];
  return decimal(row.amount);
}
