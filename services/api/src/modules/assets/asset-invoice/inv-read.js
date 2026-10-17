// Assets — Purchase Invoice-to-Asset Creation, the reads: invoices with assets still to register, one invoice with its header, lines,
// capacity and every asset linked to it (through the invoice line, its receipt or its purchase order line), registration batches,
// exceptions, reconciliation, reports and the export. Amounts only with a cost permission.
import { has, uuid } from "../common.js";
import { BATCH_STATUS, ELIGIBLE_BILL, INV, OUTCOME, dayOfDb, invError, requireInvoiceView, seesInvoiceCost } from "./inv-rules.js";
import { batchView, invoiceBlock, lineCapacity, loadInvoice } from "./inv-commands.js";

const money = (c, v) => (seesInvoiceCost(c) ? (v === null || v === undefined ? null : String(v)) : undefined);
const idOf = (v, label) => { try { return uuid(v, label); } catch { throw invError(404, "ASSET_INVOICE_NOT_ELIGIBLE"); } };

export async function listEligibleInvoices(client, c, filters = {}) {
  requireInvoiceView(c);
  const search = String(filters.search ?? "").slice(0, 100);
  const bills = (await client.query(`SELECT bill.id, bill.bill_number, bill.supplier_invoice_reference, to_char(bill.bill_date, 'YYYY-MM-DD') AS date, bill.status, party.display_name AS supplier, btrim(bill.currency_code) AS currency, bill.grand_total
      FROM tenant.accounting_vendor_bills bill LEFT JOIN tenant.business_parties party ON party.id = bill.party_id
      WHERE bill.organization_id = $1 AND bill.bill_type = 'bill' AND bill.status = ANY($2::text[])
        AND EXISTS (SELECT 1 FROM tenant.accounting_vendor_bill_lines l WHERE l.vendor_bill_id = bill.id AND COALESCE(l.product_type, 'non_stock') = 'non_stock')
        AND ($3 = '' OR bill.bill_number ILIKE '%' || $3 || '%' OR COALESCE(bill.supplier_invoice_reference, '') ILIKE '%' || $3 || '%' OR party.display_name ILIKE '%' || $3 || '%')
      ORDER BY bill.bill_date DESC LIMIT 100`, [c.organizationId, ELIGIBLE_BILL, search])).rows;
  const out = [];
  for (const b of bills) {
    const lines = (await client.query(`SELECT * FROM tenant.accounting_vendor_bill_lines WHERE vendor_bill_id = $1 AND COALESCE(product_type, 'non_stock') = 'non_stock'`, [b.id])).rows;
    let remaining = 0;
    let registered = 0;
    let quantity = 0;
    for (const l of lines) { const cap = await lineCapacity(client, c, l); remaining += cap.units; registered += cap.registered; quantity += cap.invoiced; }
    if (remaining < 1 && !filters.includeRegistered) continue;
    out.push({ invoiceId: b.id, number: b.bill_number, supplierInvoice: b.supplier_invoice_reference, date: b.date, supplier: b.supplier, status: b.status, total: money(c, b.grand_total), currency: b.currency,
      quantity, registered, remaining, href: `/assets/capitalization/invoices/${b.id}` });
  }
  return { rows: out };
}
// One invoice: header, lines with their capacity, linked assets, registration batches and what the person may do.
export async function getInvoiceSource(client, c, invoiceId) {
  requireInvoiceView(c);
  const bill = await loadInvoice(client, c, invoiceId);
  const block = invoiceBlock(bill);
  const cost = seesInvoiceCost(c);
  const lines = (await client.query(`SELECT line.*, uom.code AS uom_code, pol.line_number AS po_line_number, po.purchase_order_number, po.id AS po_id FROM tenant.accounting_vendor_bill_lines line
      LEFT JOIN tenant.units_of_measure uom ON uom.id = line.uom_id LEFT JOIN tenant.purchase_order_lines pol ON pol.id = line.purchase_order_line_id LEFT JOIN tenant.purchase_orders po ON po.id = pol.purchase_order_id
      WHERE line.vendor_bill_id = $1 ORDER BY line.sequence`, [bill.id])).rows;
  const outLines = [];
  for (const l of lines) {
    const cap = await lineCapacity(client, c, l);
    outLines.push({ sourceLineId: l.id, sequence: l.sequence, description: l.description, kind: cap.kind, kindLabel: { non_stock: "Goods (non-stock)", stock: "Stock item", service: "Service" }[cap.kind] ?? cap.kind, uom: l.uom_code,
      invoiced: cap.invoiced, received: cap.received, returned: cap.returned, receiptRequired: cap.receiptRequired, registered: cap.registered, remaining: cap.units, suggested: cap.suggested && !cap.code,
      eligible: !block && !cap.code, reason: block ?? cap.reason, code: block ? "ASSET_INVOICE_NOT_ELIGIBLE" : cap.code, serviceReview: cap.serviceReview,
      purchaseOrder: l.po_id ? { id: l.po_id, number: l.purchase_order_number, line: l.po_line_number } : null,
      ...(cost ? { unitPrice: String(l.unit_price), lineDiscount: String(l.line_discount_amount ?? 0), invoiceDiscount: String(l.allocated_document_discount ?? 0), net: String(l.net_amount), tax: String(l.tax_amount),
        unitNet: cap.invoiced > 0 ? (Math.round((Number(l.net_amount) / cap.invoiced) * 100) / 100).toFixed(2) : null } : {}) });
  }
  return {
    invoiceId: bill.id, number: bill.bill_number, supplierInvoice: bill.supplier_invoice_reference ?? null, supplier: bill.supplier_name, date: bill.bill_day, status: bill.status, currency: String(bill.currency_code ?? "").trim(),
    exchangeRate: cost ? String(bill.exchange_rate) : undefined, total: money(c, bill.grand_total), tax: money(c, bill.tax_total), discount: money(c, bill.discount_total), eligible: !block, block,
    billHref: `/procurement/supplier-bills/${bill.id}`, lines: outLines, assets: await linkedAssets(client, c, bill), batches: (await listInvoiceRegistrationBatches(client, c, { invoiceId: bill.id })).rows,
    can: { create: !block && (has(c, INV.create) || has(c, INV.bulk)), bulk: has(c, INV.bulk), cost, requestCapitalization: has(c, "assets.capitalization.request") },
    note: "Creating assets from this invoice never creates another purchase, payable, tax posting or capitalization: Finance capitalizes them separately.",
  };
}
// Assets linked to the invoice: through its lines, and through the purchase order lines they bill (registered from the receipt).
async function linkedAssets(client, c, bill) {
  const rows = (await client.query(`SELECT DISTINCT ON (a.id) a.id, a.asset_number, a.name, a.serial_number, a.lifecycle_status, a.capitalization_class, x.source_type, x.allocated_cost, line.description, line.id AS line_id,
        (SELECT k.status FROM tenant.asset_capitalizations k WHERE k.asset_id = a.id AND k.status NOT IN ('REJECTED', 'REVERSED') ORDER BY k.requested_at DESC LIMIT 1) AS cap_status
      FROM tenant.accounting_vendor_bill_lines line JOIN tenant.asset_acquisition_allocations x ON x.organization_id = line.organization_id AND x.status = 'ACTIVE'
        AND (x.source_line_id = line.id OR (line.purchase_order_line_id IS NOT NULL AND x.root_po_line_id = line.purchase_order_line_id))
      JOIN tenant.assets a ON a.id = x.asset_id WHERE line.vendor_bill_id = $1 ORDER BY a.id`, [bill.id])).rows;
  return rows.sort((p, q) => p.asset_number.localeCompare(q.asset_number)).map((r) => ({ assetId: r.id, asset: `${r.asset_number} · ${r.name}`, serialNumber: r.serial_number, lifecycle: r.lifecycle_status, sourceLineId: r.line_id,
    line: r.description, via: r.source_type === "SUPPLIER_INVOICE_LINE" ? "Invoice line" : r.source_type === "GOODS_RECEIPT_LINE" ? "Goods receipt" : "Purchase order", cost: money(c, r.allocated_cost),
    outcome: outcomeOf(r), outcomeLabel: OUTCOME[outcomeOf(r)], href: `/assets/register/${r.id}?tab=acquisition` }));
}
const outcomeOf = (r) => (r.capitalization_class === "TRACKED_ONLY" ? "TRACKED_ONLY" : r.capitalization_class === "CAPITALIZED" ? "REGISTERED_CAPITALIZATION_CONFIRMED"
  : r.cap_status && r.cap_status !== "POSTED" ? "REGISTERED_CAPITALIZATION_PENDING" : "REGISTERED_COST_PENDING");
export async function listInvoiceRegistrationBatches(client, c, filters = {}) {
  requireInvoiceView(c);
  const values = [c.organizationId];
  let where = "";
  if (filters.invoiceId) { values.push(idOf(filters.invoiceId, "Invoice")); where = `AND b.vendor_bill_id = $${values.length}`; }
  const rows = (await client.query(`SELECT b.*, bill.bill_number, COALESCE(NULLIF(u.full_name, ''), u.email) AS requester FROM tenant.asset_invoice_registration_batches b JOIN tenant.accounting_vendor_bills bill ON bill.id = b.vendor_bill_id
      LEFT JOIN public.users u ON u.id = b.requested_by WHERE b.organization_id = $1 ${where} ORDER BY b.created_at DESC LIMIT 300`, values)).rows;
  return { rows: rows.map((b) => ({ id: b.id, number: `AIR-${b.batch_number}`, invoice: b.bill_number, invoiceId: b.vendor_bill_id, status: b.status, statusLabel: BATCH_STATUS[b.status], assetsCreated: b.assets_created,
    failedLines: (b.result?.lines ?? []).filter((l) => l.status === "FAILED").length, requestedBy: b.requester, at: b.created_at, href: `/assets/capitalization/registrations/${b.id}` })) };
}
export async function getInvoiceRegistrationBatch(client, c, batchId) {
  requireInvoiceView(c);
  const b = (await client.query(`SELECT b.*, bill.bill_number FROM tenant.asset_invoice_registration_batches b JOIN tenant.accounting_vendor_bills bill ON bill.id = b.vendor_bill_id WHERE b.organization_id = $1 AND b.id = $2`,
    [c.organizationId, idOf(batchId, "Batch")])).rows[0];
  if (!b) throw invError(404, "ASSET_INVOICE_NOT_ELIGIBLE", "That registration was not found.");
  const ids = (b.result?.assets ?? []).map((a) => a.assetId);
  const now = ids.length ? (await client.query(`SELECT a.id, a.asset_number, a.name, a.serial_number, a.lifecycle_status, a.capitalization_class,
      (SELECT k.status FROM tenant.asset_capitalizations k WHERE k.asset_id = a.id AND k.status NOT IN ('REJECTED', 'REVERSED') ORDER BY k.requested_at DESC LIMIT 1) AS cap_status FROM tenant.assets a WHERE a.id = ANY($1::uuid[]) ORDER BY a.asset_number`, [ids])).rows : [];
  return { ...batchView(b), invoice: b.bill_number, statusLabel: BATCH_STATUS[b.status], invoiceHref: `/assets/capitalization/invoices/${b.vendor_bill_id}`,
    assetsNow: now.map((r) => ({ assetId: r.id, asset: `${r.asset_number} · ${r.name}`, serialNumber: r.serial_number, lifecycle: r.lifecycle_status, outcome: outcomeOf(r), outcomeLabel: OUTCOME[outcomeOf(r)], href: `/assets/register/${r.id}?tab=acquisition` })) };
}

// ------------------------------------------------------------------ exceptions and reconciliation
export async function getInvoiceExceptions(client, c) {
  requireInvoiceView(c);
  const out = [];
  const q = async (sql) => (await client.query(sql, [c.organizationId])).rows;
  for (const r of await q(`SELECT DISTINCT bill.id, bill.bill_number, bill.status FROM tenant.accounting_vendor_bills bill JOIN tenant.accounting_vendor_bill_lines line ON line.vendor_bill_id = bill.id
      JOIN tenant.asset_acquisition_allocations x ON x.source_line_id = line.id AND x.status = 'ACTIVE' WHERE bill.organization_id = $1 AND bill.status IN ('cancelled', 'reversed')`)) {
    out.push({ kind: "INVOICE_CANCELLED", label: `Invoice ${r.status} after assets were registered`, subject: r.bill_number, href: `/assets/capitalization/invoices/${r.id}` });
  }
  // Goods returned after their assets were registered: more assets than units kept.
  for (const r of await q(`SELECT p.purchase_order_line_id, p.accepted_quantity, p.returned_quantity, (SELECT COALESCE(sum(x.allocated_quantity), 0) FROM tenant.asset_acquisition_allocations x WHERE x.status = 'ACTIVE'
        AND (x.root_po_line_id = p.purchase_order_line_id OR x.source_line_id = p.purchase_order_line_id)) AS registered, pol.description, po.purchase_order_number
      FROM tenant.purchase_order_line_progress p JOIN tenant.purchase_order_lines pol ON pol.id = p.purchase_order_line_id JOIN tenant.purchase_orders po ON po.id = pol.purchase_order_id
      WHERE p.organization_id = $1 AND p.returned_quantity > 0`)) {
    if (Number(r.registered) > Number(r.accepted_quantity) - Number(r.returned_quantity) + 1e-9) out.push({ kind: "RETURNED_AFTER_REGISTRATION", label: "Goods returned after their assets were registered", subject: `${r.purchase_order_number} · ${r.description}`, href: "/assets/capitalization?view=reconciliation" });
  }
  for (const r of await q(`SELECT DISTINCT cn.id, cn.bill_number FROM tenant.accounting_vendor_bills cn JOIN tenant.accounting_vendor_bill_lines cl ON cl.vendor_bill_id = cn.id
      JOIN tenant.asset_acquisition_allocations x ON x.status = 'ACTIVE' AND cl.purchase_order_line_id IS NOT NULL AND (x.root_po_line_id = cl.purchase_order_line_id)
      WHERE cn.organization_id = $1 AND cn.bill_type = 'credit_note' AND cn.status NOT IN ('draft', 'cancelled', 'reversed')
        AND NOT EXISTS (SELECT 1 FROM tenant.asset_capitalization_adjustments d WHERE d.source_line_id = cl.id AND d.status <> 'REJECTED')`)) {
    out.push({ kind: "CREDIT_NOTE", label: "Supplier credit note against registered assets — reconcile", subject: r.bill_number, href: "/assets/capitalization?view=adjustments" });
  }
  for (const r of await q(`SELECT b.id, b.batch_number, bill.bill_number FROM tenant.asset_invoice_registration_batches b JOIN tenant.accounting_vendor_bills bill ON bill.id = b.vendor_bill_id WHERE b.organization_id = $1 AND b.status IN ('PARTIAL', 'RECOVERY_REQUIRED') ORDER BY b.created_at DESC LIMIT 100`)) {
    out.push({ kind: "PARTIAL", label: "Registration partly completed — lines still to fix", subject: `AIR-${r.batch_number} · ${r.bill_number}`, href: `/assets/capitalization/registrations/${r.id}` });
  }
  return out;
}
export async function getInvoiceReconciliation(client, c) {
  if (!has(c, INV.reconcile) && !seesInvoiceCost(c)) throw invError(403, "ASSET_INVOICE_PERMISSION_DENIED");
  const lines = (await client.query(`SELECT DISTINCT line.*, bill.bill_number, bill.id AS bill_id, bill.status AS bill_status FROM tenant.accounting_vendor_bill_lines line JOIN tenant.accounting_vendor_bills bill ON bill.id = line.vendor_bill_id
      JOIN tenant.asset_acquisition_allocations x ON x.organization_id = line.organization_id AND (x.source_line_id = line.id OR (line.purchase_order_line_id IS NOT NULL AND x.root_po_line_id = line.purchase_order_line_id))
      WHERE line.organization_id = $1 AND bill.bill_type = 'bill' LIMIT 500`, [c.organizationId])).rows;
  const out = [];
  for (const l of lines) {
    const cap = await lineCapacity(client, c, l);
    const allocated = Number((await client.query(`SELECT COALESCE(sum(allocated_cost), 0) AS n FROM tenant.asset_acquisition_allocations WHERE status = 'ACTIVE' AND (source_line_id = $1 OR ($2::uuid IS NOT NULL AND root_po_line_id = $2))`,
      [l.id, l.purchase_order_line_id])).rows[0].n);
    out.push({ invoice: l.bill_number, invoiceId: l.bill_id, description: l.description, invoiced: cap.invoiced, received: cap.received, registered: cap.registered, remaining: cap.units,
      ...(seesInvoiceCost(c) ? { value: String(l.net_amount), allocated: allocated.toFixed(2), unallocated: (Number(l.net_amount) - allocated).toFixed(2) } : {}),
      fullyRegistered: cap.registered >= cap.invoiced - 1e-9, excess: cap.registered > cap.invoiced + 1e-9 || (cap.receiptRequired && cap.received !== null && cap.registered > cap.received + 1e-9) || (seesInvoiceCost(c) && allocated > Number(l.net_amount) + 0.005),
      invoiceStatus: l.bill_status });
  }
  return { lines: out, note: "Registered units never exceed what was invoiced and received; allocated value never exceeds the line's net amount." };
}

// ------------------------------------------------------------------ reports and export
export const INVOICE_REPORTS = Object.freeze(["invoices-pending-registration", "invoice-asset-traceability", "partial-registrations", "duplicate-registration-exceptions", "capitalization-pending",
  "invoice-cost-allocation", "invoice-returns-credits", "source-reconciliation"]);
export async function getInvoiceReport(client, c, kind) {
  if (!INVOICE_REPORTS.includes(kind)) throw invError(400, "ASSET_INVOICE_INVALID", "Unknown report.");
  requireInvoiceView(c);
  if (kind === "invoice-cost-allocation" && !seesInvoiceCost(c)) throw invError(403, "ASSET_INVOICE_PERMISSION_DENIED");
  const q = async (sql) => (await client.query(sql, [c.organizationId])).rows;
  switch (kind) {
    case "invoices-pending-registration": return (await listEligibleInvoices(client, c, {})).rows.map((r) => ({ invoice: r.number, supplier: r.supplier, date: r.date, invoiced: r.quantity, registered: r.registered, remaining: r.remaining, href: r.href }));
    case "invoice-asset-traceability": return (await q(`SELECT a.id, a.asset_number, a.serial_number, bill.bill_number, bill.id AS bill_id, line.description FROM tenant.asset_acquisition_allocations x JOIN tenant.assets a ON a.id = x.asset_id
        JOIN tenant.accounting_vendor_bill_lines line ON line.id = x.source_line_id JOIN tenant.accounting_vendor_bills bill ON bill.id = line.vendor_bill_id WHERE x.organization_id = $1 AND x.status = 'ACTIVE' AND x.source_type = 'SUPPLIER_INVOICE_LINE'
        ORDER BY bill.bill_number, a.asset_number LIMIT 2000`)).map((r) => ({ invoice: r.bill_number, line: r.description, asset: r.asset_number, serial: r.serial_number ?? "—", href: `/assets/register/${r.id}?tab=acquisition` }));
    case "partial-registrations": return (await listEligibleInvoices(client, c, {})).rows.filter((r) => r.registered > 0 && r.remaining > 0).map((r) => ({ invoice: r.number, registered: r.registered, remaining: r.remaining, href: r.href }));
    case "duplicate-registration-exceptions": return (await getInvoiceExceptions(client, c)).filter((e) => ["RETURNED_AFTER_REGISTRATION", "INVOICE_CANCELLED"].includes(e.kind)).map((e) => ({ issue: e.label, subject: e.subject, href: e.href }));
    case "capitalization-pending": return (await q(`SELECT a.id, a.asset_number, a.name, bill.bill_number FROM tenant.asset_acquisition_allocations x JOIN tenant.assets a ON a.id = x.asset_id JOIN tenant.accounting_vendor_bill_lines line ON line.id = x.source_line_id
        JOIN tenant.accounting_vendor_bills bill ON bill.id = line.vendor_bill_id WHERE x.organization_id = $1 AND x.status = 'ACTIVE' AND a.capitalization_class = 'PENDING' AND a.archived_at IS NULL ORDER BY a.asset_number`))
      .map((r) => ({ asset: `${r.asset_number} · ${r.name}`, invoice: r.bill_number, href: `/assets/register/${r.id}?tab=financials` }));
    case "invoice-cost-allocation": return (await q(`SELECT a.id, a.asset_number, bill.bill_number, x.allocated_cost, x.cost_status, (SELECT COALESCE(sum(reporting_amount), 0) FROM tenant.asset_cost_components k WHERE k.asset_id = a.id AND k.status = 'ACTIVE') AS extra
        FROM tenant.asset_acquisition_allocations x JOIN tenant.assets a ON a.id = x.asset_id JOIN tenant.accounting_vendor_bill_lines line ON line.id = x.source_line_id JOIN tenant.accounting_vendor_bills bill ON bill.id = line.vendor_bill_id
        WHERE x.organization_id = $1 AND x.status = 'ACTIVE' ORDER BY a.asset_number LIMIT 2000`)).map((r) => ({ asset: r.asset_number, invoice: r.bill_number, purchasePrice: String(r.allocated_cost ?? ""), otherCosts: String(r.extra),
        costStatus: r.cost_status === "FINANCE_CONFIRMED" ? "Confirmed by Finance" : "Proposed", href: `/assets/register/${r.id}?tab=financials` }));
    case "invoice-returns-credits": return (await getInvoiceExceptions(client, c)).filter((e) => ["CREDIT_NOTE", "RETURNED_AFTER_REGISTRATION"].includes(e.kind)).map((e) => ({ issue: e.label, subject: e.subject, href: e.href }));
    case "source-reconciliation": return (await getInvoiceReconciliation(client, c)).lines.map((l) => ({ invoice: l.invoice, line: l.description, invoiced: l.invoiced, received: l.received ?? "—", registered: l.registered, remaining: l.remaining,
      ...(l.value !== undefined ? { value: l.value, allocated: l.allocated } : {}), check: l.excess ? "Excess — review" : l.fullyRegistered ? "Fully registered" : "Open" }));
    default: return [];
  }
}
const csvCell = (value) => { const s = value === null || value === undefined ? "" : String(value); return /[",\r\n]/.test(s) || /^[=+@-]/.test(s) ? `"${(/^[=+@-]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s; };
export async function exportInvoiceRegistration(client, c, batchId) {
  if (!has(c, INV.export)) throw invError(403, "ASSET_INVOICE_PERMISSION_DENIED");
  const b = await getInvoiceRegistrationBatch(client, c, batchId);
  const rows = [["Batch", "Invoice", "Asset", "Serial", "Status", "Acquisition"], ...b.assetsNow.map((a) => [b.number, b.invoice, a.asset, a.serialNumber, a.lifecycle, a.outcomeLabel]),
    ...b.lines.filter((l) => l.status === "FAILED").map((l) => [b.number, b.invoice, `Not registered: ${l.description}`, "", "", l.errors.map((e) => e.message).join(" ")])];
  return { fileName: `${b.number}-assets.csv`, csv: rows.map((r) => r.map(csvCell).join(",")).join("\r\n") };
}
export { dayOfDb as _dayOfDb };
