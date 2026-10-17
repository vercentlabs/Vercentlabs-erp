// Projects — Project Revenue, the reads. Four separate measures, each from the module that owns it:
//   contract value   the project's share of confirmed Sales Order lines (current version; earlier versions kept as history),
//   net invoiced     the tax-exclusive value of issued invoice lines attributed to the project, less issued credit notes against them,
//   recognized       Finance's posted revenue journal lines for those documents, deferred-revenue releases and project-tagged journals,
//   collections      Finance's receipt and credit allocations against those invoices, with outstanding and overdue balances.
// Attribution is explicit — an order line the project is linked to (or allocated), an invoice line allocated to it, an invoice linked to
// it, an expense recharge — never a match on the customer's name. One line is never counted twice: a line shared by projects without an
// allocation is an exception, not a double count. Everything is derived on read, so the projection rebuilds itself from its sources.
import { has, isoDay, uuid, visibilitySql } from "../project-core.js";
import { addMoney, cmpMoney, moneyOut, subMoney } from "../expenses/expense-rules.js";
import { DOC_ISSUED, DOC_PENDING, MODEL_LABEL, ORDER_CONTRACTED, ORDER_PROPOSED, RECEIPT_LIVE, REV, convert, maxZero, pct, prorate, requireRevenue, revenueError, revenueScope } from "./revenue-rules.js";

const day = (value) => (value ? isoDay(value) : null);
const m = (value) => moneyOut(value ?? "0") ?? "0.00";
const sum = (values) => addMoney("0", ...values.map((value) => value ?? "0"));
const stateOf = (status) => (DOC_ISSUED.includes(status) ? "ISSUED" : DOC_PENDING.includes(status) ? "PENDING" : "VOID");
const keyOf = (orderId, sequence) => `${orderId}:${sequence}`;
export const baseCurrency = async (client, c) => (await client.query(`SELECT upper(base_currency) AS c FROM public.organizations WHERE id = $1`, [c.organizationId])).rows[0]?.c ?? "INR";
// A document amount in the company's currency: as is when the document is in it, at the document's recorded rate otherwise; null when no rate.
const toBase = (amount, currency, rate, base) => (String(currency ?? base).trim().toUpperCase() === base ? m(amount) : rate ? convert(amount, rate) : null);

// ------------------------------------------------------------------ 1. the contract
async function contractOf(client, c, project, base) {
  const q = async (sql, values) => (await client.query(sql, values)).rows;
  const links = await q(`SELECT link.source_id AS order_id, link.source_line_id FROM tenant.project_links link
      WHERE link.organization_id = $1 AND link.project_id = $2 AND link.source_type = 'SALES_ORDER' AND link.removed_at IS NULL`, [c.organizationId, project.id]);
  const orderIds = [...new Set(links.map((row) => row.order_id))];
  if (!orderIds.length) return { orders: [], lines: [], allocations: [], orderIds, amendments: [] };
  const orders = await q(`SELECT so.id, so.sales_order_number, so.party_id, so.lifecycle_status, so.confirmed_at, version.version_number, btrim(version.currency_code) AS currency, version.exchange_rate,
        version.taxable_total, version.id AS version_id
      FROM tenant.sales_orders so JOIN tenant.sales_order_versions version ON version.id = so.current_version_id WHERE so.organization_id = $1 AND so.id = ANY($2::uuid[])`, [c.organizationId, orderIds]);
  // Every project's links to these orders, resolved to line positions (a link without a line covers the whole order).
  const allLinks = await q(`SELECT link.project_id, link.source_id AS order_id, line.sequence FROM tenant.project_links link JOIN tenant.projects project ON project.id = link.project_id AND project.deleted_at IS NULL
      LEFT JOIN tenant.sales_order_lines line ON line.id = link.source_line_id
      WHERE link.organization_id = $1 AND link.source_type = 'SALES_ORDER' AND link.source_id = ANY($2::uuid[]) AND link.removed_at IS NULL`, [c.organizationId, orderIds]);
  const current = await q(`SELECT line.id, line.sequence, version.sales_order_id AS order_id, line.item_id, line.item_name_snapshot, line.description_snapshot, line.quantity, line.unit_price, line.uom_snapshot,
        COALESCE(line.taxable_amount, NULLIF(line.net_amount, 0), line.quantity * line.unit_price) AS value
      FROM tenant.sales_order_lines line JOIN tenant.sales_order_versions version ON version.id = line.sales_order_version_id JOIN tenant.sales_orders so ON so.current_version_id = version.id
     WHERE line.organization_id = $1 AND so.id = ANY($2::uuid[]) ORDER BY so.sales_order_number, line.sequence`, [c.organizationId, orderIds]);
  const original = await q(`SELECT DISTINCT ON (version.sales_order_id, line.sequence) version.sales_order_id AS order_id, line.sequence, version.version_number,
        COALESCE(line.taxable_amount, NULLIF(line.net_amount, 0), line.quantity * line.unit_price) AS value
      FROM tenant.sales_order_lines line JOIN tenant.sales_order_versions version ON version.id = line.sales_order_version_id
     WHERE line.organization_id = $1 AND version.sales_order_id = ANY($2::uuid[]) ORDER BY version.sales_order_id, line.sequence, version.version_number`, [c.organizationId, orderIds]);
  const allocations = await q(`SELECT allocation.*, project.project_code FROM tenant.project_revenue_contract_allocations allocation JOIN tenant.projects project ON project.id = allocation.project_id
      WHERE allocation.organization_id = $1 AND allocation.sales_order_id = ANY($2::uuid[]) AND allocation.status = 'ACTIVE'`, [c.organizationId, orderIds]);
  const tm = new Set((await q(`SELECT version.sales_order_id AS order_id, line.sequence FROM tenant.project_time_contract_lines contract JOIN tenant.sales_order_lines line ON line.id = contract.sales_order_line_id
      JOIN tenant.sales_order_versions version ON version.id = line.sales_order_version_id WHERE contract.organization_id = $1 AND contract.project_id = $2`, [c.organizationId, project.id])).map((row) => keyOf(row.order_id, row.sequence)));
  const milestones = await q(`SELECT milestone.id, milestone.milestone_code, milestone.name, milestone.status, milestone.approval_status, to_char(milestone.current_due_date, 'YYYY-MM-DD') AS due,
        to_char(milestone.completed_at, 'YYYY-MM-DD') AS completed, version.sales_order_id AS order_id, line.sequence,
        (SELECT request.status FROM tenant.project_milestone_billing_requests request WHERE request.milestone_id = milestone.id AND request.status <> 'WITHDRAWN' LIMIT 1) AS billing_request
      FROM tenant.project_milestones milestone JOIN tenant.sales_order_lines line ON line.id = milestone.sales_order_line_id JOIN tenant.sales_order_versions version ON version.id = line.sales_order_version_id
     WHERE milestone.organization_id = $1 AND milestone.project_id = $2 AND milestone.status <> 'CANCELLED' ORDER BY milestone.sequence, milestone.milestone_code`, [c.organizationId, project.id]);
  const msKeys = new Set(milestones.map((row) => keyOf(row.order_id, row.sequence)));
  const amendments = await q(`SELECT amendment.id, amendment.sales_order_id, amendment.reason, amendment.created_at, so.sales_order_number, f.version_number AS from_version, t.version_number AS to_version,
        f.taxable_total AS from_total, t.taxable_total AS to_total FROM tenant.sales_order_amendments amendment JOIN tenant.sales_orders so ON so.id = amendment.sales_order_id
        LEFT JOIN tenant.sales_order_versions f ON f.id = amendment.from_version_id LEFT JOIN tenant.sales_order_versions t ON t.id = amendment.to_version_id
     WHERE amendment.organization_id = $1 AND amendment.sales_order_id = ANY($2::uuid[]) ORDER BY amendment.created_at`, [c.organizationId, orderIds]);
  const orderById = new Map(orders.map((row) => [row.id, row]));
  const covered = (projectId, orderId, sequence) => allLinks.some((row) => row.project_id === projectId && row.order_id === orderId && (row.sequence === null || row.sequence === sequence));
  const originalOf = new Map(original.map((row) => [keyOf(row.order_id, row.sequence), row]));
  const lines = [];
  for (const line of current) {
    if (!covered(project.id, line.order_id, line.sequence)) continue;
    const order = orderById.get(line.order_id);
    const key = keyOf(line.order_id, line.sequence);
    const onLine = allocations.filter((row) => row.sales_order_id === line.order_id && row.line_sequence === line.sequence);
    const mine = onLine.find((row) => row.project_id === project.id) ?? null;
    const others = [...new Set(allLinks.filter((row) => row.project_id !== project.id && row.order_id === line.order_id && (row.sequence === null || row.sequence === line.sequence)).map((row) => row.project_id))];
    const value = m(line.value);
    const allocatedTotal = sum(onLine.map((row) => row.allocated_amount));
    const basis = onLine.length ? "ALLOCATED" : others.length ? "SHARED" : "WHOLE_LINE";
    if (basis === "ALLOCATED" && !mine) continue; // the line is divided among other projects; none of it is this one's
    const amountDoc = basis === "ALLOCATED" ? m(mine.allocated_amount) : value;
    const status = order.lifecycle_status;
    const customerMismatch = Boolean(project.customer_id) && order.party_id !== project.customer_id;
    const contracted = ORDER_CONTRACTED.includes(status) && !customerMismatch && project.status !== "DRAFT";
    const orig = originalOf.get(key);
    lines.push({
      key, orderId: line.order_id, orderNumber: order.sales_order_number, orderStatus: status, version: order.version_number, lineId: line.id, sequence: line.sequence,
      item: line.item_name_snapshot, description: line.description_snapshot, quantity: String(line.quantity), unitPrice: m(line.unit_price), uom: line.uom_snapshot,
      currency: order.currency || base, rate: order.exchange_rate, lineValue: value, model: tm.has(key) ? "TIME_AND_MATERIALS" : msKeys.has(key) ? "MILESTONE" : "FIXED",
      basis, sharedWith: others.length, allocation: mine ? { id: mine.id, number: `RCA-${mine.allocation_number}`, amount: m(mine.allocated_amount), quantity: mine.allocated_quantity === null ? null : String(mine.allocated_quantity), reason: mine.reason } : null,
      allocatedTotal: onLine.length ? allocatedTotal : null, capacityLeft: onLine.length ? subMoney(value, allocatedTotal) : null, overallocated: onLine.length > 0 && cmpMoney(allocatedTotal, value) > 0,
      amount: amountDoc, amountBase: toBase(amountDoc, order.currency, order.exchange_rate, base),
      originalBase: orig ? toBase(basis === "ALLOCATED" ? amountDoc : m(orig.value), order.currency, order.exchange_rate, base) : null, originalVersion: orig?.version_number ?? null,
      contracted, proposed: !contracted && !customerMismatch && (ORDER_PROPOSED.includes(status) || project.status === "DRAFT"), cancelled: status === "cancelled", customerMismatch,
      href: `/sales/orders/${line.order_id}`,
    });
  }
  return { orders, lines, allocations, orderIds, amendments, milestones };
}

// ------------------------------------------------------------------ 2. invoices and credit notes
async function invoicesOf(client, c, project, contract, base) {
  const q = async (sql, values) => (await client.query(sql, values)).rows;
  const keys = new Map(contract.lines.map((line) => [line.key, line]));
  const candidates = await q(`SELECT line.id, line.customer_invoice_id, line.sequence AS line_sequence, line.description, line.quantity, line.unit_price, line.net_amount, line.tax_amount, version.sales_order_id AS order_id,
        order_line.sequence AS order_sequence, invoice.invoice_number, invoice.status, invoice.party_id, to_char(invoice.invoice_date, 'YYYY-MM-DD') AS invoice_date, to_char(invoice.due_date, 'YYYY-MM-DD') AS due_date,
        btrim(invoice.currency_code) AS currency, invoice.exchange_rate, invoice.content_hash, invoice.updated_at
      FROM tenant.accounting_customer_invoice_lines line JOIN tenant.accounting_customer_invoices invoice ON invoice.id = line.customer_invoice_id AND invoice.invoice_type = 'invoice'
      LEFT JOIN tenant.sales_order_lines order_line ON order_line.id = line.source_sales_order_line_id LEFT JOIN tenant.sales_order_versions version ON version.id = order_line.sales_order_version_id
     WHERE line.organization_id = $1 AND (
        line.id IN (SELECT customer_invoice_line_id FROM tenant.project_revenue_invoice_allocations WHERE organization_id = $1 AND project_id = $2 AND status = 'CURRENT')
        OR version.sales_order_id = ANY($3::uuid[])
        OR invoice.id IN (SELECT source_id FROM tenant.project_links WHERE organization_id = $1 AND project_id = $2 AND source_type = 'SALES_INVOICE' AND removed_at IS NULL)
        OR line.id IN (SELECT customer_invoice_line_id FROM tenant.project_expense_billing_requests WHERE organization_id = $1 AND project_id = $2 AND customer_invoice_line_id IS NOT NULL))
     ORDER BY invoice.invoice_date, invoice.invoice_number, line.sequence`, [c.organizationId, project.id, contract.orderIds]);
  const lineIds = candidates.map((row) => row.id);
  const invoiceIds = [...new Set(candidates.map((row) => row.customer_invoice_id))];
  const explicit = lineIds.length ? await q(`SELECT allocation.*, project.project_code FROM tenant.project_revenue_invoice_allocations allocation JOIN tenant.projects project ON project.id = allocation.project_id
      WHERE allocation.organization_id = $1 AND allocation.customer_invoice_line_id = ANY($2::uuid[]) AND allocation.status = 'CURRENT'`, [c.organizationId, lineIds]) : [];
  const invoiceLinks = invoiceIds.length ? await q(`SELECT link.project_id, link.source_id FROM tenant.project_links link JOIN tenant.projects project ON project.id = link.project_id AND project.deleted_at IS NULL
      WHERE link.organization_id = $1 AND link.source_type = 'SALES_INVOICE' AND link.source_id = ANY($2::uuid[]) AND link.removed_at IS NULL`, [c.organizationId, invoiceIds]) : [];
  const expenseLines = new Set(lineIds.length ? (await q(`SELECT customer_invoice_line_id AS id FROM tenant.project_expense_billing_requests WHERE organization_id = $1 AND project_id = $2 AND customer_invoice_line_id = ANY($3::uuid[])`,
    [c.organizationId, project.id, lineIds])).map((row) => row.id) : []);
  const allocatedProjects = (key) => new Set(contract.allocations.filter((row) => keyOf(row.sales_order_id, row.line_sequence) === key).map((row) => row.project_id));
  const exceptions = [];
  // What the screen needs to offer an unattributed line for allocation.
  const pick = (row) => ({ invoiceLineId: row.id, invoiceId: row.customer_invoice_id, invoiceNumber: row.invoice_number, lineSequence: row.line_sequence, net: m(row.net_amount), currency: row.currency });
  const lines = [];
  for (const row of candidates) {
    const net = m(row.net_amount);
    const onLine = explicit.filter((allocation) => allocation.customer_invoice_line_id === row.id);
    const key = row.order_id ? keyOf(row.order_id, row.order_sequence) : null;
    let amount = "0.00";
    let basis = null;
    if (onLine.length) {
      const mine = onLine.filter((allocation) => allocation.project_id === project.id);
      amount = sum(mine.map((allocation) => allocation.allocated_net_amount));
      basis = "ALLOCATED";
      if (cmpMoney(sum(onLine.map((allocation) => allocation.allocated_net_amount)), net) > 0) exceptions.push({ kind: "INVOICE_OVERALLOCATED", code: "PROJECT_REVENUE_INVOICE_OVERALLOCATED", message: `${row.invoice_number} line ${row.line_sequence} is allocated beyond its value across projects.` });
    } else if (key && keys.has(key)) {
      const contractLine = keys.get(key);
      if (contractLine.basis === "WHOLE_LINE" || (contractLine.basis === "ALLOCATED" && allocatedProjects(key).size === 1)) { amount = net; basis = "CONTRACT_LINE"; }
      else exceptions.push({ kind: "INVOICE_LINE_UNALLOCATED", code: "PROJECT_REVENUE_RECONCILIATION_REQUIRED", ...pick(row), message: `${row.invoice_number} line ${row.line_sequence} bills ${contractLine.orderNumber} line ${contractLine.sequence}, which serves several projects: allocate the invoice line.` });
    } else if (expenseLines.has(row.id)) { amount = net; basis = "EXPENSE_RECHARGE"; }
    else if (!key || !contract.orderIds.includes(row.order_id)) {
      const linkers = new Set(invoiceLinks.filter((link) => link.source_id === row.customer_invoice_id).map((link) => link.project_id));
      if (linkers.has(project.id) && linkers.size === 1) { amount = net; basis = "INVOICE_LINK"; }
      else if (linkers.has(project.id)) exceptions.push({ kind: "INVOICE_LINE_UNALLOCATED", code: "PROJECT_REVENUE_RECONCILIATION_REQUIRED", ...pick(row), message: `${row.invoice_number} is linked to several projects: allocate its lines.` });
    }
    if (cmpMoney(amount, "0") <= 0) continue;
    const state = stateOf(row.status);
    const tax = prorate(m(row.tax_amount), amount, net);
    if (row.party_id !== project.customer_id && project.customer_id && state !== "VOID") exceptions.push({ kind: "INVOICE_OTHER_CUSTOMER", code: "PROJECT_REVENUE_CUSTOMER_MISMATCH", message: `${row.invoice_number} was issued to another customer; it keeps its original customer.` });
    const amountBase = toBase(amount, row.currency, row.exchange_rate, base);
    if (amountBase === null) exceptions.push({ kind: "CURRENCY", code: "PROJECT_REVENUE_CURRENCY_UNSUPPORTED", message: `${row.invoice_number} is in ${row.currency} with no recorded exchange rate: it is left out of the totals.` });
    lines.push({ lineId: row.id, invoiceId: row.customer_invoice_id, number: row.invoice_number, status: row.status, state, date: row.invoice_date, due: row.due_date, lineSequence: row.line_sequence,
      description: row.description, quantity: row.quantity === null ? null : String(row.quantity), net, amount, tax, gross: addMoney(amount, tax), amountBase, taxBase: toBase(tax, row.currency, row.exchange_rate, base),
      currency: row.currency, rate: row.exchange_rate, key, basis, partyId: row.party_id, contentHash: row.content_hash, href: `/sales/invoices/${row.customer_invoice_id}` });
  }
  // Each attributed invoice: its whole tax-exclusive value and this project's part of it (shares of gross, payments and outstanding follow it).
  const attributedIds = [...new Set(lines.map((line) => line.invoiceId))];
  const invoiceRows = attributedIds.length ? await q(`SELECT invoice.id, invoice.invoice_number, invoice.status, invoice.grand_total, invoice.tax_total, invoice.outstanding_amount, btrim(invoice.currency_code) AS currency, invoice.exchange_rate,
        to_char(invoice.invoice_date, 'YYYY-MM-DD') AS invoice_date, to_char(invoice.due_date, 'YYYY-MM-DD') AS due_date, (current_date - invoice.due_date) AS days_past_due,
        (SELECT COALESCE(sum(line.net_amount), 0) FROM tenant.accounting_customer_invoice_lines line WHERE line.customer_invoice_id = invoice.id) AS lines_net
      FROM tenant.accounting_customer_invoices invoice WHERE invoice.organization_id = $1 AND invoice.id = ANY($2::uuid[])`, [c.organizationId, attributedIds]) : [];
  const invoices = invoiceRows.map((row) => {
    const mine = sum(lines.filter((line) => line.invoiceId === row.id).map((line) => line.amount));
    return { id: row.id, number: row.invoice_number, status: row.status, state: stateOf(row.status), date: row.invoice_date, due: row.due_date, daysPastDue: Number(row.days_past_due ?? 0), currency: row.currency,
      rate: row.exchange_rate, net: m(row.lines_net), mine, grandTotal: m(row.grand_total), outstanding: m(row.outstanding_amount), href: `/sales/invoices/${row.id}` };
  });
  // Credit notes against them: a credit line follows its source line's share, otherwise the invoice's share.
  const creditRows = attributedIds.length ? await q(`SELECT note.id AS note_id, note.invoice_number, note.status, note.source_invoice_id, to_char(note.invoice_date, 'YYYY-MM-DD') AS note_date, btrim(note.currency_code) AS currency, note.exchange_rate,
        line.id AS line_id, line.net_amount, line.tax_amount, sales_line.source_invoice_line_id, sales_line.credit_type, sales_note.reason_code, sales_note.reason_note
      FROM tenant.accounting_customer_invoices note JOIN tenant.accounting_customer_invoice_lines line ON line.customer_invoice_id = note.id
      LEFT JOIN tenant.sales_credit_note_lines sales_line ON sales_line.customer_invoice_line_id = line.id LEFT JOIN tenant.sales_credit_notes sales_note ON sales_note.customer_invoice_id = note.id
     WHERE note.organization_id = $1 AND note.invoice_type = 'credit_note' AND note.source_invoice_id = ANY($2::uuid[]) ORDER BY note.invoice_date, note.invoice_number, line.sequence`, [c.organizationId, attributedIds]) : [];
  const lineById = new Map(lines.map((line) => [line.lineId, line]));
  const invoiceById = new Map(invoices.map((row) => [row.id, row]));
  const credits = [];
  for (const row of creditRows) {
    const source = row.source_invoice_line_id ? lineById.get(row.source_invoice_line_id) : null;
    const inv = invoiceById.get(row.source_invoice_id);
    const net = m(row.net_amount);
    const amount = row.source_invoice_line_id ? (source ? prorate(net, source.amount, source.net) : "0.00") : prorate(net, inv.mine, inv.net);
    if (cmpMoney(amount, "0") <= 0) continue;
    credits.push({ creditId: row.note_id, lineId: row.line_id, number: row.invoice_number, status: row.status, state: stateOf(row.status), date: row.note_date, sourceInvoiceId: row.source_invoice_id, sourceInvoice: inv.number,
      sourceLineId: row.source_invoice_line_id, key: source?.key ?? null, net, amount, amountBase: toBase(amount, row.currency, row.exchange_rate, base), creditType: row.credit_type, reason: row.reason_note ?? row.reason_code ?? null,
      href: `/sales/credit-notes/${row.note_id}` });
  }
  // Invoice allocations whose line no longer exists (Sales rewrote a draft) are flagged.
  const stale = await q(`SELECT allocation.id, allocation.allocation_number FROM tenant.project_revenue_invoice_allocations allocation WHERE allocation.organization_id = $1 AND allocation.project_id = $2 AND allocation.status = 'CURRENT'
      AND NOT EXISTS (SELECT 1 FROM tenant.accounting_customer_invoice_lines line WHERE line.id = allocation.customer_invoice_line_id)`, [c.organizationId, project.id]);
  for (const row of stale) exceptions.push({ kind: "SOURCE_MISSING", code: "PROJECT_REVENUE_SOURCE_MISSING", allocationId: row.id, message: `Invoice allocation RIA-${row.allocation_number} points at an invoice line that no longer exists: reverse it.` });
  const changed = await q(`SELECT allocation.allocation_number, invoice.invoice_number FROM tenant.project_revenue_invoice_allocations allocation JOIN tenant.accounting_customer_invoices invoice ON invoice.id = allocation.customer_invoice_id
      WHERE allocation.organization_id = $1 AND allocation.project_id = $2 AND allocation.status = 'CURRENT' AND allocation.source_version IS NOT NULL AND invoice.content_hash IS DISTINCT FROM allocation.source_version`, [c.organizationId, project.id]);
  for (const row of changed) exceptions.push({ kind: "SOURCE_CHANGED", code: "PROJECT_REVENUE_VERSION_CONFLICT", message: `${row.invoice_number} changed after allocation RIA-${row.allocation_number} was made: review it.` });
  return { lines, invoices, credits, exceptions };
}

// ------------------------------------------------------------------ 3. recognized revenue (Finance)
async function recognitionOf(client, c, project, inv) {
  const q = async (sql, values) => (await client.query(sql, values)).rows;
  const docIds = [...new Set([...inv.lines.map((line) => line.invoiceId), ...inv.credits.map((credit) => credit.creditId)])];
  const lineShare = new Map([...inv.lines.map((line) => [line.lineId, line]), ...inv.credits.map((credit) => [credit.lineId, credit])]);
  const docShare = new Map(inv.invoices.map((row) => [row.id, { part: row.mine, whole: row.net }]));
  for (const credit of inv.credits) {
    const prior = docShare.get(credit.creditId) ?? { part: "0.00", whole: "0.00" };
    docShare.set(credit.creditId, { part: addMoney(prior.part, credit.amount), whole: addMoney(prior.whole, credit.net) });
  }
  const portion = (amount, src, docId) => {
    const line = src ? lineShare.get(src) : null;
    if (line) return prorate(amount, line.amount, line.net);
    const share = docShare.get(docId);
    return share ? prorate(amount, share.part, share.whole) : "0.00";
  };
  const rows = [];
  const counted = new Set();
  if (docIds.length) {
    const entries = await q(`SELECT entry.id, entry.entry_number, entry.status, entry.source_type, entry.source_id, entry.reversal_of_id, to_char(entry.accounting_date, 'YYYY-MM-DD') AS d, entry.fiscal_period_id, period.name AS period
        FROM tenant.accounting_journal_entries entry LEFT JOIN tenant.fiscal_periods period ON period.id = entry.fiscal_period_id
       WHERE entry.organization_id = $1 AND entry.status IN ('posted', 'reversed') AND ((entry.source_type IN ('customer_invoice', 'customer_credit_note') AND entry.source_id = ANY($2::uuid[]))
          OR entry.reversal_of_id IN (SELECT id FROM tenant.accounting_journal_entries WHERE organization_id = $1 AND source_type IN ('customer_invoice', 'customer_credit_note') AND source_id = ANY($2::uuid[])))`, [c.organizationId, docIds]);
    const ids = entries.map((row) => row.id);
    const jl = ids.length ? await q(`SELECT line.journal_entry_id, line.sequence, COALESCE(line.base_credit_amount, line.credit_amount, 0) - COALESCE(line.base_debit_amount, line.debit_amount, 0) AS signed, line.metadata->>'sourceLineId' AS src,
          account.code, account.name, account.account_class FROM tenant.accounting_journal_lines line JOIN tenant.accounting_accounts account ON account.id = line.account_id
         WHERE line.organization_id = $1 AND line.journal_entry_id = ANY($2::uuid[]) ORDER BY line.journal_entry_id, line.sequence`, [c.organizationId, ids]) : [];
    const byEntry = new Map(entries.map((row) => [row.id, row]));
    const srcOf = new Map(jl.map((line) => [`${line.journal_entry_id}:${line.sequence}`, line.src]));
    for (const line of jl) {
      if (line.account_class !== "revenue") continue;
      const entry = byEntry.get(line.journal_entry_id);
      const original = entry.reversal_of_id ? byEntry.get(entry.reversal_of_id) : null;
      // A reversal copies the original's lines in order: it takes each line's source from the original.
      const src = line.src ?? (original ? srcOf.get(`${original.id}:${line.sequence}`) : null);
      const docId = original ? original.source_id : entry.source_id;
      const amount = portion(m(line.signed), src, docId);
      if (cmpMoney(amount, "0") === 0) continue;
      counted.add(entry.id);
      rows.push({ entryId: entry.id, entryNumber: entry.entry_number, date: entry.d, periodId: entry.fiscal_period_id, period: entry.period, account: `${line.code} · ${line.name}`,
        source: original ? "Reversal" : entry.source_type === "customer_credit_note" ? "Credit note" : "Invoice", documentId: docId, amount, href: `/finance/journals/${entry.id}` });
    }
  }
  // Deferred revenue: schedules Finance keeps for these invoices, released into revenue over time.
  const invoiceIds = inv.invoices.map((row) => row.id);
  const schedules = invoiceIds.length ? await q(`SELECT schedule.id, schedule.code, schedule.source_id, schedule.total_amount, schedule.recognized_amount, schedule.status FROM tenant.accounting_accrual_schedules schedule
      WHERE schedule.organization_id = $1 AND schedule.schedule_type = 'deferred_revenue' AND schedule.source_id = ANY($2::uuid[])`, [c.organizationId, invoiceIds]) : [];
  let deferred = schedules.length ? "0.00" : null;
  for (const schedule of schedules) {
    deferred = addMoney(deferred, portion(subMoney(m(schedule.total_amount), m(schedule.recognized_amount)), null, schedule.source_id));
    const released = await q(`SELECT entry.id, entry.entry_number, to_char(entry.accounting_date, 'YYYY-MM-DD') AS d, entry.fiscal_period_id, period.name AS period, account.code, account.name,
          COALESCE(line.base_credit_amount, line.credit_amount, 0) - COALESCE(line.base_debit_amount, line.debit_amount, 0) AS signed
        FROM tenant.accounting_accrual_recognitions recognition JOIN tenant.accounting_journal_entries entry ON entry.id = recognition.journal_entry_id AND entry.status IN ('posted', 'reversed')
        JOIN tenant.accounting_journal_lines line ON line.journal_entry_id = entry.id JOIN tenant.accounting_accounts account ON account.id = line.account_id AND account.account_class = 'revenue'
        LEFT JOIN tenant.fiscal_periods period ON period.id = entry.fiscal_period_id WHERE recognition.organization_id = $1 AND recognition.schedule_id = $2`, [c.organizationId, schedule.id]);
    for (const row of released) {
      if (counted.has(row.id)) continue;
      counted.add(row.id);
      rows.push({ entryId: row.id, entryNumber: row.entry_number, date: row.d, periodId: row.fiscal_period_id, period: row.period, account: `${row.code} · ${row.name}`, source: "Deferred revenue release",
        documentId: schedule.source_id, amount: portion(m(row.signed), null, schedule.source_id), href: `/finance/journals/${row.id}` });
    }
  }
  // Journals Finance tagged to the project directly (the project dimension), weighted by the tag's percentage.
  const tagged = await q(`SELECT entry.id, entry.entry_number, to_char(entry.accounting_date, 'YYYY-MM-DD') AS d, entry.fiscal_period_id, period.name AS period, account.code, account.name, tag.allocation_percent,
        COALESCE(line.base_credit_amount, line.credit_amount, 0) - COALESCE(line.base_debit_amount, line.debit_amount, 0) AS signed
      FROM tenant.accounting_line_dimensions tag JOIN tenant.accounting_dimension_values value ON value.id = tag.dimension_value_id
      JOIN tenant.accounting_dimensions dimension ON dimension.id = value.dimension_id AND dimension.source_type = 'project'
      JOIN tenant.accounting_journal_lines line ON line.id = tag.journal_line_id JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id AND entry.status IN ('posted', 'reversed')
      JOIN tenant.accounting_accounts account ON account.id = line.account_id AND account.account_class = 'revenue' LEFT JOIN tenant.fiscal_periods period ON period.id = entry.fiscal_period_id
     WHERE tag.organization_id = $1 AND value.source_record_id = $2 AND NOT (entry.id = ANY($3::uuid[]))`, [c.organizationId, project.id, [...counted]]);
  for (const row of tagged) rows.push({ entryId: row.id, entryNumber: row.entry_number, date: row.d, periodId: row.fiscal_period_id, period: row.period, account: `${row.code} · ${row.name}`, source: "Journal (project-tagged)",
    documentId: null, amount: prorate(m(row.signed), String(row.allocation_percent ?? 100), "100"), href: `/finance/journals/${row.id}` });
  const accrual = (await q(`SELECT COALESCE(sum(total_amount - recognized_amount), 0) AS open, count(*)::int AS n FROM tenant.accounting_accrual_schedules WHERE organization_id = $1 AND schedule_type = 'accrual'
      AND source_type = 'project' AND source_id = $2 AND status NOT IN ('cancelled')`, [c.organizationId, project.id]))[0];
  const periodNow = (await q(`SELECT id, name FROM tenant.fiscal_periods WHERE organization_id = $1 AND start_date <= current_date AND end_date >= current_date ORDER BY end_date - start_date LIMIT 1`, [c.organizationId]))[0] ?? null;
  const issuedDocs = inv.invoices.some((row) => row.state === "ISSUED");
  const available = rows.length > 0 || !issuedDocs;
  return {
    available, total: available ? sum(rows.map((row) => row.amount)) : null, rows,
    currentPeriod: periodNow && available ? { name: periodNow.name, amount: sum(rows.filter((row) => row.periodId === periodNow.id).map((row) => row.amount)) } : null,
    deferred, accrued: accrual.n ? m(accrual.open) : null, reversals: rows.filter((row) => row.source === "Reversal").length,
  };
}

// ------------------------------------------------------------------ 4. collections (Finance)
async function collectionsOf(client, c, project, contract, inv, base) {
  const q = async (sql, values) => (await client.query(sql, values)).rows;
  const issued = inv.invoices.filter((row) => row.state === "ISSUED");
  const ids = issued.map((row) => row.id);
  const receipts = ids.length ? await q(`SELECT allocation.customer_invoice_id, allocation.allocated_amount, allocation.allocated_at, receipt.receipt_number, receipt.id AS receipt_id, to_char(receipt.receipt_date, 'YYYY-MM-DD') AS receipt_date
      FROM tenant.accounting_customer_receipt_allocations allocation JOIN tenant.accounting_customer_receipts receipt ON receipt.id = allocation.receipt_id
     WHERE allocation.organization_id = $1 AND allocation.customer_invoice_id = ANY($2::uuid[]) AND receipt.status = ANY($3::text[]) ORDER BY receipt.receipt_date`, [c.organizationId, ids, RECEIPT_LIVE]) : [];
  const creditAllocations = ids.length ? await q(`SELECT customer_invoice_id, allocated_amount FROM tenant.accounting_customer_credit_allocations WHERE organization_id = $1 AND customer_invoice_id = ANY($2::uuid[])`, [c.organizationId, ids]) : [];
  const rows = issued.map((row) => {
    const share = (amount) => toBase(prorate(amount, row.mine, row.net), row.currency, row.rate, base) ?? "0.00";
    const paid = receipts.filter((r) => r.customer_invoice_id === row.id);
    const settled = share(sum(paid.map((r) => m(r.allocated_amount))));
    const credited = share(sum(creditAllocations.filter((r) => r.customer_invoice_id === row.id).map((r) => m(r.allocated_amount))));
    const outstanding = share(row.outstanding);
    const overdue = cmpMoney(outstanding, "0") > 0 && row.daysPastDue > 0;
    return { invoiceId: row.id, number: row.number, date: row.date, due: row.due, status: row.status, gross: share(row.grandTotal), settled, credited, outstanding, overdue, daysOverdue: overdue ? row.daysPastDue : 0,
      receipts: paid.map((r) => ({ number: r.receipt_number, date: r.receipt_date, amount: share(m(r.allocated_amount)) })), href: row.href };
  });
  // Advances against the project's orders: money held, not revenue earned (the project's share when the order serves several projects).
  const orderValue = new Map();
  for (const line of contract.lines.filter((l) => l.contracted)) orderValue.set(line.orderId, addMoney(orderValue.get(line.orderId) ?? "0", line.amount));
  const advances = [];
  for (const order of contract.orders.filter((row) => orderValue.has(row.id))) {
    const share = { part: orderValue.get(order.id), whole: m(order.taxable_total ?? orderValue.get(order.id)) };
    for (const row of await q(`SELECT id, amount, status, payment_reference, to_char(received_at, 'YYYY-MM-DD') AS d, btrim(currency_code) AS currency FROM tenant.sales_advance_payments WHERE organization_id = $1 AND sales_order_id = $2 AND status <> 'cancelled'`,
      [c.organizationId, order.id])) {
      advances.push({ id: row.id, order: order.sales_order_number, date: row.d, status: row.status, reference: row.payment_reference,
        amount: toBase(cmpMoney(share.whole, "0") > 0 ? prorate(m(row.amount), share.part, share.whole) : m(row.amount), row.currency, order.exchange_rate, base) ?? "0.00" });
    }
  }
  return {
    rows, gross: sum(rows.map((r) => r.gross)), settled: sum(rows.map((r) => r.settled)), credited: sum(rows.map((r) => r.credited)), outstanding: sum(rows.map((r) => r.outstanding)),
    overdue: sum(rows.filter((r) => r.overdue).map((r) => r.outstanding)), overdueCount: rows.filter((r) => r.overdue).length,
    advances, advancesUnapplied: sum(advances.filter((a) => a.status === "recorded").map((a) => a.amount)), advancesApplied: sum(advances.filter((a) => a.status === "applied").map((a) => a.amount)),
  };
}

// ------------------------------------------------------------------ 5. unbilled work and the billing schedule
async function unbilledOf(client, c, project, contract, inv) {
  const q = async (sql, values) => (await client.query(sql, values)).rows;
  const invoicedByKey = new Map();
  const pendingByKey = new Map();
  for (const line of inv.lines.filter((l) => l.key)) {
    if (line.state === "ISSUED") invoicedByKey.set(line.key, addMoney(invoicedByKey.get(line.key) ?? "0", line.amount));
    if (line.state === "PENDING") pendingByKey.set(line.key, addMoney(pendingByKey.get(line.key) ?? "0", line.amount));
  }
  for (const credit of inv.credits.filter((cr) => cr.key && cr.state === "ISSUED")) invoicedByKey.set(credit.key, subMoney(invoicedByKey.get(credit.key) ?? "0", credit.amount));
  const contractLines = contract.lines.filter((line) => line.contracted).map((line) => {
    const invoiced = invoicedByKey.get(line.key) ?? "0.00";
    return { key: line.key, orderNumber: line.orderNumber, sequence: line.sequence, item: line.item, model: line.model, amount: line.amount, invoiced, pending: pendingByKey.get(line.key) ?? "0.00", remaining: maxZero(subMoney(line.amount, invoiced)),
      overbilled: cmpMoney(invoiced, line.amount) > 0 };
  });
  const time = await q(`SELECT contract.id, contract.label, contract.hourly_rate, btrim(contract.currency) AS currency, contract.max_minutes,
        COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.entry_status = 'APPROVED'), 0)::int AS approved,
        COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.entry_status = 'SUBMITTED'), 0)::int AS submitted,
        COALESCE((SELECT sum(a.allocated_minutes) FROM tenant.project_time_billing_allocations a JOIN tenant.project_time_entries e ON e.id = a.entry_id WHERE e.contract_line_id = contract.id AND a.status IN ('INVOICED', 'REQUESTED')), 0)::int AS billed
      FROM tenant.project_time_contract_lines contract LEFT JOIN tenant.project_time_entries entry ON entry.contract_line_id = contract.id AND entry.billing_classification = 'TIME_AND_MATERIALS_ELIGIBLE'
     WHERE contract.organization_id = $1 AND contract.project_id = $2 GROUP BY contract.id ORDER BY contract.line_number`, [c.organizationId, project.id]);
  const timeLines = time.map((row) => {
    const unbilledMinutes = Math.max(row.approved - row.billed, 0);
    const value = prorate(m(row.hourly_rate), String(unbilledMinutes), "60");
    return { contractLineId: row.id, label: row.label, rate: m(row.hourly_rate), currency: row.currency, capMinutes: row.max_minutes, approvedMinutes: row.approved, billedMinutes: row.billed, unbilledMinutes,
      submittedMinutes: row.submitted, unbilledValue: value };
  });
  const schedule = (contract.milestones ?? []).map((row) => {
    const key = keyOf(row.order_id, row.sequence);
    const line = contract.lines.find((l) => l.key === key);
    const invoiced = invoicedByKey.get(key) ?? "0.00";
    const amount = line?.amount ?? null;
    const done = amount !== null && cmpMoney(invoiced, amount) >= 0;
    const ready = !done && (Boolean(row.billing_request) || (row.status === "COMPLETED" && ["APPROVED", "NOT_REQUIRED"].includes(row.approval_status)));
    return { milestoneId: row.id, code: row.milestone_code, name: row.name, status: row.status, due: row.due, completed: row.completed, orderNumber: line?.orderNumber ?? null, amount, invoiced,
      state: done ? "INVOICED" : ready ? "READY_TO_BILL" : "NOT_YET_ELIGIBLE", href: `/projects/${project.id}/milestones/${row.id}` };
  });
  const expenses = (await q(`SELECT COALESCE(sum(total_amount), 0) AS total, count(*)::int AS n FROM tenant.project_expense_billing_requests WHERE organization_id = $1 AND project_id = $2 AND status = 'SUBMITTED'`,
    [c.organizationId, project.id]))[0];
  return {
    contractLines, contractRemaining: sum(contractLines.filter((l) => l.model !== "TIME_AND_MATERIALS").map((l) => l.remaining)), timeCapRemaining: sum(contractLines.filter((l) => l.model === "TIME_AND_MATERIALS").map((l) => l.remaining)),
    time: timeLines, approvedTimeValue: sum(timeLines.map((l) => l.unbilledValue)), submittedMinutes: timeLines.reduce((s, l) => s + l.submittedMinutes, 0),
    schedule, readyToBill: sum(schedule.filter((s) => s.state === "READY_TO_BILL").map((s) => subMoney(s.amount ?? "0", s.invoiced))),
    expenses: { total: m(expenses.total), requests: expenses.n }, drafts: sum(inv.lines.filter((l) => l.state === "PENDING").map((l) => l.amountBase ?? "0")),
  };
}

// ------------------------------------------------------------------ the model and the summary
export async function revenueModel(client, c, project) {
  const base = await baseCurrency(client, c);
  const contract = await contractOf(client, c, project, base);
  const inv = await invoicesOf(client, c, project, contract, base);
  const recognition = await recognitionOf(client, c, project, inv);
  const collections = await collectionsOf(client, c, project, contract, inv, base);
  const unbilled = await unbilledOf(client, c, project, contract, inv);
  const issuedLines = inv.lines.filter((line) => line.state === "ISSUED" && line.amountBase !== null);
  const issuedCredits = inv.credits.filter((credit) => credit.state === "ISSUED" && credit.amountBase !== null);
  const invoicedLines = sum(issuedLines.map((line) => line.amountBase));
  const credited = sum(issuedCredits.map((credit) => credit.amountBase));
  const forecast = (await client.query(`SELECT * FROM tenant.project_revenue_forecasts WHERE organization_id = $1 AND project_id = $2 ORDER BY version DESC LIMIT 1`, [c.organizationId, project.id])).rows[0] ?? null;
  const contracted = contract.lines.filter((line) => line.contracted && line.amountBase !== null);
  return {
    base, contract, inv, recognition, collections, unbilled, forecast,
    contractValue: contracted.length ? sum(contracted.map((line) => line.amountBase)) : null,
    originalValue: contracted.length ? sum(contracted.map((line) => line.originalBase ?? line.amountBase)) : null,
    proposedValue: sum(contract.lines.filter((line) => line.proposed).map((line) => line.amountBase ?? "0")),
    grossInvoiced: sum(issuedLines.map((line) => addMoney(line.amountBase, line.taxBase ?? "0"))), invoicedLines, credited, netInvoiced: subMoney(invoicedLines, credited),
  };
}
const modelFor = async (client, c, projectId) => {
  const scope = await revenueScope(client, c, projectId);
  requireRevenue(scope.can);
  return { ...scope, model: await revenueModel(client, c, scope.project) };
};

export async function getProjectRevenueSummary(client, c, projectId) {
  const { project, can, model } = await modelFor(client, c, projectId);
  const x = model;
  const exceptions = await revenueExceptions(client, c, project, x);
  const models = [...new Set(x.contract.lines.filter((line) => line.contracted).map((line) => line.model))];
  const watermark = (await client.query(`SELECT GREATEST(
        (SELECT max(updated_at) FROM tenant.accounting_customer_invoices WHERE id = ANY($1::uuid[])),
        (SELECT max(entry.posted_at) FROM tenant.accounting_journal_entries entry WHERE entry.id = ANY($2::uuid[])),
        (SELECT max(allocated_at) FROM tenant.accounting_customer_receipt_allocations WHERE customer_invoice_id = ANY($1::uuid[]))) AS at`,
  [x.inv.invoices.map((row) => row.id), x.recognition.rows.map((row) => row.entryId)])).rows[0].at;
  const contractInvoiced = sum(x.unbilled.contractLines.map((line) => line.invoiced));
  return {
    projectId: project.id, projectStatus: project.status, currency: x.base, calculatedAt: new Date().toISOString(), sourcesUpdatedAt: watermark,
    basis: "Contract value, net invoiced, recognized revenue and collections are separate measures from Sales and Finance. Invoiced and recognized figures exclude GST; collections are gross.",
    models: models.map((key) => ({ key, label: MODEL_LABEL[key] })), hybrid: models.length > 1,
    contract: {
      value: x.contractValue, original: x.originalValue, proposed: cmpMoney(x.proposedValue, "0") > 0 ? x.proposedValue : null,
      message: x.contractValue === null ? (project.status === "DRAFT" ? "Draft project: linked orders are shown as proposed, not contracted." : "No confirmed Sales Order lines linked") : null,
      amendments: x.contract.amendments.length, orders: [...new Set(x.contract.lines.filter((line) => line.contracted).map((line) => line.orderNumber))],
      invoicedPercent: x.contractValue === null ? null : pct(contractInvoiced, x.contractValue),
    },
    invoiced: { gross: x.grossInvoiced, lines: x.invoicedLines, credited: x.credited, net: x.netInvoiced, invoices: x.inv.invoices.filter((row) => row.state === "ISSUED").length, pending: x.unbilled.drafts },
    recognized: can.recognition ? { available: x.recognition.available, total: x.recognition.total, currentPeriod: x.recognition.currentPeriod, deferred: x.recognition.deferred, accrued: x.recognition.accrued,
      message: x.recognition.available ? null : "Finance has not provided recognized revenue for this project's invoices yet." } : null,
    collections: can.collections ? { gross: x.collections.gross, settled: x.collections.settled, credited: x.collections.credited, outstanding: x.collections.outstanding, overdue: x.collections.overdue,
      overdueInvoices: x.collections.overdueCount, advancesUnapplied: x.collections.advancesUnapplied, advancesApplied: x.collections.advancesApplied } : null,
    unbilled: { contractRemaining: x.contractValue === null ? null : x.unbilled.contractRemaining, timeCapRemaining: x.unbilled.timeCapRemaining, approvedTimeValue: x.unbilled.approvedTimeValue,
      submittedMinutes: x.unbilled.submittedMinutes, readyToBill: x.unbilled.readyToBill, expenses: x.unbilled.expenses, drafts: x.unbilled.drafts },
    forecast: x.forecast ? { version: x.forecast.version, expectedFurther: m(x.forecast.expected_further_revenue), asOf: day(x.forecast.as_of_date), assumptions: x.forecast.assumptions, at: x.forecast.created_at,
      label: "Manual forecast — not contracted, invoiced or recognized." } : null,
    exceptions: exceptions.length,
    can: { contracts: can.contracts, invoices: can.invoices, recognition: can.recognition, collections: can.collections, profitability: can.profitability, manageLinks: can.manageLinks, forecast: can.forecast,
      reconcile: can.reconcile, export: can.export },
  };
}

// ------------------------------------------------------------------ the detail views
export async function getProjectRevenueView(client, c, projectId, view) {
  const { project, can, model: x } = await modelFor(client, c, projectId);
  switch (view) {
    case "contracts": {
      requireRevenue(can, "contracts");
      return { lines: x.contract.lines, amendments: x.contract.amendments.map((row) => ({ id: row.id, order: row.sales_order_number, fromVersion: row.from_version, toVersion: row.to_version, from: m(row.from_total), to: m(row.to_total),
        reason: row.reason, at: row.created_at, href: `/sales/orders/${row.sales_order_id}` })) };
    }
    case "invoices": requireRevenue(can, "invoices"); return { lines: x.inv.lines, invoices: x.inv.invoices.map(({ rate, ...row }) => row), credits: x.inv.credits };
    case "recognition": requireRevenue(can, "recognition"); return x.recognition;
    case "collections": requireRevenue(can, "collections"); return x.collections;
    case "unbilled": return { contractLines: can.contracts ? x.unbilled.contractLines : x.unbilled.contractLines.map(({ key, orderNumber, model, remaining, invoiced }) => ({ key, orderNumber, model, remaining, invoiced })),
      time: x.unbilled.time.map((row) => (can.contracts ? row : { ...row, rate: null })), expenses: x.unbilled.expenses, drafts: x.unbilled.drafts };
    case "schedule": return { rows: x.unbilled.schedule };
    case "exceptions": return { rows: await revenueExceptions(client, c, project, x) };
    case "forecasts": return { rows: (await client.query(`SELECT version, expected_further_revenue, to_char(as_of_date, 'YYYY-MM-DD') AS as_of, assumptions, created_by, created_at FROM tenant.project_revenue_forecasts
        WHERE organization_id = $1 AND project_id = $2 ORDER BY version DESC`, [c.organizationId, project.id])).rows.map((row) => ({ version: row.version, expectedFurther: m(row.expected_further_revenue), asOf: row.as_of, assumptions: row.assumptions, at: row.created_at })) };
    default: throw revenueError(404, "PROJECT_REVENUE_INPUT_INVALID", "Unknown revenue view.");
  }
}

// ------------------------------------------------------------------ exceptions and reconciliation
export async function revenueExceptions(client, c, project, x) {
  const out = [...x.inv.exceptions];
  for (const line of x.contract.lines) {
    if (line.customerMismatch) out.push({ kind: "CUSTOMER_MISMATCH", code: "PROJECT_REVENUE_CUSTOMER_MISMATCH", message: `${line.orderNumber} belongs to a different customer: it is not counted.` });
    if (line.overallocated) out.push({ kind: "CONTRACT_OVERALLOCATED", code: "PROJECT_REVENUE_CONTRACT_OVERALLOCATED", message: `${line.orderNumber} line ${line.sequence} is allocated ${line.allocatedTotal} across projects, more than its ${line.lineValue}.` });
    if (line.basis === "SHARED" && line.contracted) out.push({ kind: "SHARED_LINE_UNALLOCATED", code: "PROJECT_REVENUE_RECONCILIATION_REQUIRED", message: `${line.orderNumber} line ${line.sequence} is linked to ${line.sharedWith + 1} projects without an allocation: allocate its value.` });
    if (line.amountBase === null) out.push({ kind: "CURRENCY", code: "PROJECT_REVENUE_CURRENCY_UNSUPPORTED", message: `${line.orderNumber} is in ${line.currency} with no recorded exchange rate.` });
  }
  for (const line of x.unbilled.contractLines.filter((l) => l.overbilled)) out.push({ kind: "OVERBILLED", code: "PROJECT_REVENUE_RECONCILIATION_REQUIRED", message: `${line.orderNumber} line ${line.sequence} is invoiced beyond its contract amount.` });
  if (!x.recognition.available) out.push({ kind: "RECOGNITION_UNAVAILABLE", code: "PROJECT_REVENUE_RECOGNITION_UNAVAILABLE", message: "Issued invoices have no Finance revenue posting yet: recognized revenue is unavailable, not zero." });
  if (project.status === "CANCELLED" && (cmpMoney(x.collections.outstanding, "0") > 0 || cmpMoney(x.collections.advancesUnapplied, "0") > 0))
    out.push({ kind: "CANCELLED_OPEN_BALANCE", code: "PROJECT_REVENUE_RECONCILIATION_REQUIRED", message: "The project is cancelled with open receivables or unapplied advances: Sales and Finance decide refunds, credits or retention." });
  return out;
}
// Rechecks every attributed figure against its source: line shares within the line, contract allocations within the order line, and
// Finance's revenue posting for each issued line equal to the project's part of it.
export async function reconcileProjectRevenue(client, c, projectId) {
  const { project, can, model: x } = await modelFor(client, c, projectId);
  if (!can.reconcile && !can.lead) throw revenueError(403, "PROJECT_REVENUE_PERMISSION_DENIED");
  const checks = [];
  const capacity = x.contract.lines.filter((line) => line.overallocated).map((line) => `${line.orderNumber}/${line.sequence}`);
  checks.push({ key: "contract", label: "Contract allocations within each order line", ok: capacity.length === 0, details: capacity });
  const lineTotals = (await client.query(`SELECT allocation.customer_invoice_line_id, sum(allocation.allocated_net_amount) AS total, max(line.net_amount) AS net FROM tenant.project_revenue_invoice_allocations allocation
      LEFT JOIN tenant.accounting_customer_invoice_lines line ON line.id = allocation.customer_invoice_line_id WHERE allocation.organization_id = $1 AND allocation.status = 'CURRENT'
        AND allocation.customer_invoice_line_id = ANY($2::uuid[]) GROUP BY allocation.customer_invoice_line_id`, [c.organizationId, x.inv.lines.map((line) => line.lineId)])).rows;
  const over = lineTotals.filter((row) => row.net === null || cmpMoney(m(row.total), m(row.net)) > 0).map((row) => row.customer_invoice_line_id);
  checks.push({ key: "invoice", label: "Invoice allocations within each invoice line", ok: over.length === 0, details: over });
  const postedByLine = new Map();
  const srcRows = (await client.query(`SELECT line.metadata->>'sourceLineId' AS src, sum(COALESCE(line.base_credit_amount, line.credit_amount, 0) - COALESCE(line.base_debit_amount, line.debit_amount, 0)) AS amount
      FROM tenant.accounting_journal_lines line JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id AND entry.status = 'posted' AND entry.reversal_of_id IS NULL
      JOIN tenant.accounting_accounts account ON account.id = line.account_id AND account.account_class = 'revenue'
     WHERE line.organization_id = $1 AND line.metadata->>'sourceLineId' = ANY($2::text[]) GROUP BY 1`, [c.organizationId, x.inv.lines.map((line) => line.lineId)])).rows;
  for (const row of srcRows) postedByLine.set(row.src, m(row.amount));
  const mismatched = x.inv.lines.filter((line) => line.state === "ISSUED" && postedByLine.has(line.lineId) && cmpMoney(postedByLine.get(line.lineId), line.net) !== 0)
    .map((line) => `${line.number}/${line.lineSequence}: posted ${postedByLine.get(line.lineId)}, line ${line.net}`);
  checks.push({ key: "recognition", label: "Finance's revenue posting equals each issued line", ok: mismatched.length === 0, details: mismatched });
  const totals = cmpMoney(sum(x.inv.lines.filter((line) => line.state === "ISSUED" && line.amountBase !== null).map((line) => line.amountBase)), x.invoicedLines) === 0;
  checks.push({ key: "totals", label: "Summary totals equal their lines", ok: totals, details: totals ? [] : ["net invoiced"] });
  const exceptions = await revenueExceptions(client, c, project, x);
  return { projectId: project.id, consistent: checks.every((check) => check.ok), checks, exceptions, checkedAt: new Date().toISOString() };
}

// ------------------------------------------------------------------ the measures other features compare against (Project Cost)
export async function projectRevenueMeasures(client, c, project) {
  const x = await revenueModel(client, c, project);
  return { contractValue: x.contractValue, netInvoiced: x.netInvoiced, recognized: x.recognition.available ? x.recognition.total : null, invoices: x.inv.invoices.filter((row) => row.state === "ISSUED").length, currency: x.base };
}

// ------------------------------------------------------------------ reports and export
export const REVENUE_REPORTS = Object.freeze(["contract-value", "invoiced", "recognized", "unbilled-contract", "unbilled-time", "milestone-schedule", "collections", "receivables", "overdue",
  "by-service-line", "by-period", "revenue-vs-cost", "amendments", "credit-notes", "exceptions"]);
export async function getProjectRevenueReport(client, c, kind = "contract-value", filters = {}) {
  if (!REVENUE_REPORTS.includes(kind)) throw revenueError(400, "PROJECT_REVENUE_INPUT_INVALID", "Unknown report.");
  if (!has(c, REV.summary)) throw revenueError(403, "PROJECT_REVENUE_PERMISSION_DENIED");
  const need = { recognized: REV.recognition, "by-period": REV.recognition, collections: REV.collections, receivables: REV.collections, overdue: REV.collections, "revenue-vs-cost": REV.profitability,
    amendments: REV.contracts, "by-service-line": REV.contracts, "credit-notes": REV.invoices }[kind];
  if (need && !has(c, need)) throw revenueError(403, "PROJECT_REVENUE_PERMISSION_DENIED");
  const projects = (await client.query(`SELECT project.* FROM tenant.projects project WHERE project.organization_id = $1 AND project.deleted_at IS NULL
      AND (${has(c, REV.reconcile) ? "TRUE" : visibilitySql(c, "project", "$2")}) AND ($3::uuid IS NULL OR project.id = $3) AND ($2::uuid IS NULL OR TRUE)
      AND (project.classification = 'CUSTOMER' OR EXISTS (SELECT 1 FROM tenant.project_links link WHERE link.project_id = project.id AND link.removed_at IS NULL AND link.source_module IN ('SALES', 'FINANCE')))
     ORDER BY project.project_code LIMIT 300`, [c.organizationId, c.userId ?? null, filters.projectId ? uuid(filters.projectId, "Project") : null])).rows;
  const rows = [];
  for (const project of projects) rows.push({ project, x: await revenueModel(client, c, project) });
  const tag = (project) => ({ projectId: project.id, project: project.project_code });
  switch (kind) {
    case "contract-value": {
      const out = rows.map(({ project, x }) => ({ ...tag(project), original: x.originalValue, current: x.contractValue, proposed: x.proposedValue, orders: [...new Set(x.contract.lines.filter((l) => l.contracted).map((l) => l.orderNumber))].join(", ") }));
      // The company total counts each order line once: its allocations where divided, its value once where shared.
      const seen = new Map();
      for (const { x } of rows) for (const line of x.contract.lines.filter((l) => l.contracted && l.amountBase !== null)) {
        const prior = seen.get(line.key);
        if (line.basis === "ALLOCATED") seen.set(line.key, { allocated: true, amount: addMoney(prior?.allocated ? prior.amount : "0", line.amountBase) });
        else if (!prior) seen.set(line.key, { allocated: false, amount: line.amountBase });
      }
      out.push({ projectId: null, project: "Company total (each order line once)", original: null, current: sum([...seen.values()].map((v) => v.amount)), proposed: null, orders: "", total: true });
      return out;
    }
    case "invoiced": return rows.map(({ project, x }) => ({ ...tag(project), gross: x.grossInvoiced, lines: x.invoicedLines, credited: x.credited, net: x.netInvoiced, pending: x.unbilled.drafts }));
    case "recognized": return rows.map(({ project, x }) => ({ ...tag(project), recognized: x.recognition.available ? x.recognition.total : null, available: x.recognition.available, deferred: x.recognition.deferred, netInvoiced: x.netInvoiced }));
    case "unbilled-contract": return rows.filter(({ x }) => x.contractValue !== null).map(({ project, x }) => ({ ...tag(project), contract: x.contractValue, invoiced: sum(x.unbilled.contractLines.map((l) => l.invoiced)), remaining: x.unbilled.contractRemaining, timeCap: x.unbilled.timeCapRemaining }));
    case "unbilled-time": return rows.flatMap(({ project, x }) => x.unbilled.time.map((l) => ({ ...tag(project), line: l.label, rate: l.rate, unbilledHours: Math.round(l.unbilledMinutes / 6) / 10, value: l.unbilledValue, pendingHours: Math.round(l.submittedMinutes / 6) / 10 })));
    case "milestone-schedule": return rows.flatMap(({ project, x }) => x.unbilled.schedule.map((s) => ({ ...tag(project), milestone: `${s.code} · ${s.name}`, amount: s.amount, invoiced: s.invoiced, state: s.state, due: s.due })));
    case "collections": return rows.map(({ project, x }) => ({ ...tag(project), gross: x.collections.gross, settled: x.collections.settled, credited: x.collections.credited, outstanding: x.collections.outstanding, advances: x.collections.advancesUnapplied }));
    case "receivables": return rows.flatMap(({ project, x }) => x.collections.rows.filter((r) => cmpMoney(r.outstanding, "0") > 0).map((r) => ({ ...tag(project), invoice: r.number, due: r.due, gross: r.gross, outstanding: r.outstanding, overdue: r.overdue })));
    case "overdue": return rows.flatMap(({ project, x }) => x.collections.rows.filter((r) => r.overdue).map((r) => ({ ...tag(project), invoice: r.number, due: r.due, daysOverdue: r.daysOverdue, outstanding: r.outstanding })));
    case "by-service-line": return rows.flatMap(({ project, x }) => x.unbilled.contractLines.map((l) => ({ ...tag(project), order: l.orderNumber, line: `${l.sequence} · ${l.item ?? ""}`, model: MODEL_LABEL[l.model], contract: l.amount, invoiced: l.invoiced, remaining: l.remaining })));
    case "by-period": return rows.flatMap(({ project, x }) => {
      const map = new Map();
      for (const r of x.recognition.rows) { const k = r.period ?? (r.date ?? "").slice(0, 7); map.set(k, addMoney(map.get(k) ?? "0", r.amount)); }
      return [...map.entries()].map(([period, amount]) => ({ ...tag(project), period, amount }));
    });
    case "revenue-vs-cost": {
      const { getProjectCostSummary } = await import("../costing/cost-read.js");
      const out = [];
      for (const { project, x } of rows) {
        const cost = await getProjectCostSummary(client, c, project.id).catch(() => null);
        const revenue = x.recognition.available ? x.recognition.total : null;
        out.push({ ...tag(project), recognized: revenue, netInvoiced: x.netInvoiced, cost: cost?.actual ?? null, contribution: revenue !== null && cost ? subMoney(revenue, cost.actual) : null,
          margin: revenue !== null && cost ? pct(subMoney(revenue, cost.actual), revenue) : null });
      }
      return out;
    }
    case "amendments": return rows.flatMap(({ project, x }) => x.contract.amendments.map((a) => ({ ...tag(project), order: a.sales_order_number, fromVersion: a.from_version, toVersion: a.to_version, from: m(a.from_total), to: m(a.to_total), reason: a.reason, at: a.created_at })));
    case "credit-notes": return rows.flatMap(({ project, x }) => x.inv.credits.map((cr) => ({ ...tag(project), creditNote: cr.number, invoice: cr.sourceInvoice, status: cr.status, amount: cr.amountBase, reason: cr.reason })));
    case "exceptions": {
      const out = [];
      for (const { project, x } of rows) for (const ex of await revenueExceptions(client, c, project, x)) out.push({ ...tag(project), ...ex });
      return out;
    }
    default: return [];
  }
}
const csvCell = (value) => { const s = value === null || value === undefined ? "" : String(value); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export async function exportProjectRevenue(client, c, projectId) {
  const { project, can, model: x } = await modelFor(client, c, projectId);
  if (!can.export) throw revenueError(403, "PROJECT_REVENUE_PERMISSION_DENIED");
  const rows = [["Measure", "Document", "Date", "Status", "Amount (" + x.base + ")", "Note"]];
  if (can.contracts) for (const line of x.contract.lines) rows.push(["Contract", `${line.orderNumber} / ${line.sequence}`, "", line.orderStatus, line.amountBase, `${MODEL_LABEL[line.model]}; ${line.basis === "ALLOCATED" ? "allocated share" : "whole line"}${line.contracted ? "" : "; not contracted"}`]);
  if (can.invoices) {
    for (const line of x.inv.lines) rows.push(["Invoice line (excl. tax)", `${line.number} / ${line.lineSequence}`, line.date, line.status, line.amountBase, line.basis]);
    for (const credit of x.inv.credits) rows.push(["Credit note (excl. tax)", credit.number, credit.date, credit.status, credit.amountBase ? `-${credit.amountBase}` : null, `against ${credit.sourceInvoice}`]);
  }
  if (can.recognition) for (const row of x.recognition.rows) rows.push(["Recognized revenue", row.entryNumber, row.date, row.source, row.amount, row.account]);
  if (can.collections) for (const row of x.collections.rows) rows.push(["Receivable (gross)", row.number, row.due, row.status, row.outstanding, `settled ${row.settled}`]);
  return { fileName: `${project.project_code}-revenue.csv`, csv: rows.map((row) => row.map(csvCell).join(",")).join("\r\n"), count: rows.length - 1 };
}
// Shared with the commands: a contract line's capacity (its current value and what every project has been allocated of it).
export async function contractLineCapacity(client, c, orderId, sequence) {
  const line = (await client.query(`SELECT line.id, line.sequence, COALESCE(line.taxable_amount, NULLIF(line.net_amount, 0), line.quantity * line.unit_price) AS value, line.quantity, version.version_number,
        btrim(version.currency_code) AS currency, so.id AS order_id, so.sales_order_number, so.party_id, so.lifecycle_status
      FROM tenant.sales_orders so JOIN tenant.sales_order_versions version ON version.id = so.current_version_id JOIN tenant.sales_order_lines line ON line.sales_order_version_id = version.id
     WHERE so.organization_id = $1 AND so.id = $2 AND line.sequence = $3`, [c.organizationId, orderId, sequence])).rows[0] ?? null;
  if (!line) return null;
  const allocated = (await client.query(`SELECT project_id, allocated_amount, allocated_quantity FROM tenant.project_revenue_contract_allocations WHERE organization_id = $1 AND sales_order_id = $2 AND line_sequence = $3 AND status = 'ACTIVE'`,
    [c.organizationId, orderId, sequence])).rows;
  return { ...line, value: m(line.value), allocated };
}
