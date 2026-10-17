// Projects — Project Revenue, the commands. The only revenue records Projects writes are attributions: how much of a Sales Order line, or
// of an issued invoice line, belongs to a project when one line serves several — and an optional, labelled revenue forecast. Each is
// checked against its source (same customer, a contracted order linked to the project, never beyond the line's value across projects),
// serialized per source line, idempotent, and ended or reversed rather than edited. Sales and Finance figures are never changed here.
import { projectEvent, text, uuid } from "../project-core.js";
import { addMoney, cmpMoney, money, moneyOut, subMoney } from "../expenses/expense-rules.js";
import { DOC_ISSUED, ORDER_CONTRACTED, revenueError, revenueScope } from "./revenue-rules.js";
import { baseCurrency, contractLineCapacity } from "./revenue-read.js";

const keyOf = (input, field = "idempotencyKey") => text(input?.[field], 200) || null;
const reasonOf = (input) => {
  const reason = text(input?.reason, 1000);
  if (reason.length < 3) throw revenueError(400, "PROJECT_REVENUE_INPUT_INVALID", "Give a reason (at least 3 characters).", { field: "reason" });
  return reason;
};
const amountOf = (value, field) => {
  try { return money(value, field); } catch { throw revenueError(400, "PROJECT_REVENUE_INPUT_INVALID", "Enter an amount greater than zero.", { field }); }
};
const lock = (client, key) => client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`project-revenue:${key}`]);

// input: { salesOrderId, lineSequence? | salesOrderLineId?, amount, quantity?, reason, idempotencyKey? } — the project's share of one order line.
// A second allocation for the same project and line supersedes the first (history kept).
export async function allocateContractLine(client, c, projectId, input = {}) {
  const key = keyOf(input);
  if (key) {
    const done = (await client.query(`SELECT id, allocation_number, allocated_amount FROM tenant.project_revenue_contract_allocations WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { allocationId: done.id, number: `RCA-${done.allocation_number}`, amount: String(done.allocated_amount), replayed: true };
  }
  const { project, can } = await revenueScope(client, c, projectId, { lock: true });
  if (!can.manageLinks) throw revenueError(403, "PROJECT_REVENUE_PERMISSION_DENIED");
  let orderId;
  try { orderId = uuid(input.salesOrderId, "Sales order"); } catch { throw revenueError(400, "PROJECT_REVENUE_INPUT_INVALID", "Choose the Sales Order.", { field: "salesOrderId" }); }
  let sequence = Number.isInteger(Number(input.lineSequence)) && input.lineSequence !== undefined && input.lineSequence !== null && input.lineSequence !== "" ? Number(input.lineSequence) : null;
  if (sequence === null && input.salesOrderLineId) {
    sequence = (await client.query(`SELECT line.sequence FROM tenant.sales_order_lines line JOIN tenant.sales_order_versions version ON version.id = line.sales_order_version_id
        WHERE line.organization_id = $1 AND line.id = $2 AND version.sales_order_id = $3`, [c.organizationId, uuid(input.salesOrderLineId, "Order line"), orderId])).rows[0]?.sequence ?? null;
  }
  if (sequence === null) throw revenueError(400, "PROJECT_REVENUE_INPUT_INVALID", "Choose the order line.", { field: "lineSequence" });
  const reason = reasonOf(input);
  const amount = amountOf(input.amount, "amount");
  await lock(client, `${orderId}:${sequence}`);
  const line = await contractLineCapacity(client, c, orderId, sequence);
  if (!line) throw revenueError(404, "PROJECT_REVENUE_SOURCE_MISSING", "That order line is not on the order's current version.");
  if (!ORDER_CONTRACTED.includes(line.lifecycle_status)) throw revenueError(409, "PROJECT_REVENUE_CONTRACT_INVALID", `${line.sales_order_number} is ${line.lifecycle_status.replace(/_/g, " ")}: only a confirmed order is contracted.`);
  if (!project.customer_id || line.party_id !== project.customer_id) throw revenueError(409, "PROJECT_REVENUE_CUSTOMER_MISMATCH");
  const linked = (await client.query(`SELECT 1 FROM tenant.project_links link LEFT JOIN tenant.sales_order_lines l ON l.id = link.source_line_id
      WHERE link.organization_id = $1 AND link.project_id = $2 AND link.source_type = 'SALES_ORDER' AND link.source_id = $3 AND link.removed_at IS NULL AND (link.source_line_id IS NULL OR l.sequence = $4) LIMIT 1`,
  [c.organizationId, project.id, orderId, sequence])).rows[0];
  if (!linked) throw revenueError(409, "PROJECT_REVENUE_CONTRACT_INVALID", `Link ${line.sales_order_number} to the project first.`);
  const others = line.allocated.filter((row) => row.project_id !== project.id);
  const othersTotal = addMoney("0", ...others.map((row) => String(row.allocated_amount)));
  if (cmpMoney(addMoney(othersTotal, amount), line.value) > 0) {
    throw revenueError(409, "PROJECT_REVENUE_CONTRACT_OVERALLOCATED", `Only ${subMoney(line.value, othersTotal)} of the line's ${line.value} is left to allocate.`, { available: subMoney(line.value, othersTotal) });
  }
  let quantity = null;
  if (input.quantity !== undefined && input.quantity !== null && input.quantity !== "") {
    quantity = Number(input.quantity);
    if (!(quantity > 0)) throw revenueError(400, "PROJECT_REVENUE_INPUT_INVALID", "Enter a quantity greater than zero.", { field: "quantity" });
    const othersQty = others.reduce((s, row) => s + Number(row.allocated_quantity ?? 0), 0);
    if (othersQty + quantity > Number(line.quantity) + 1e-9) throw revenueError(409, "PROJECT_REVENUE_CONTRACT_OVERALLOCATED", `Only ${Number(line.quantity) - othersQty} of the line's quantity is left.`);
  }
  const previous = (await client.query(`UPDATE tenant.project_revenue_contract_allocations SET status = 'SUPERSEDED', ended_by = $3, ended_at = clock_timestamp(), end_reason = $4
      WHERE organization_id = $1 AND project_id = $2 AND sales_order_id = $5 AND line_sequence = $6 AND status = 'ACTIVE' RETURNING id`, [c.organizationId, project.id, c.userId ?? null, reason, orderId, sequence])).rows[0];
  const made = (await client.query(`INSERT INTO tenant.project_revenue_contract_allocations (organization_id, project_id, customer_id, sales_order_id, sales_order_line_id, line_sequence, contract_version,
        allocated_amount, allocated_quantity, currency, reason, created_by, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, allocation_number`,
  [c.organizationId, project.id, project.customer_id, orderId, line.id, sequence, line.version_number, amount, quantity, line.currency || await baseCurrency(client, c), reason, c.userId ?? null, key])).rows[0];
  if (previous) await client.query(`UPDATE tenant.project_revenue_contract_allocations SET superseded_by = $2 WHERE id = $1`, [previous.id, made.id]);
  await projectEvent(client, c, project.id, "REVENUE_CONTRACT_ALLOCATED", `${line.sales_order_number} line ${sequence}: ${amount}`, { allocationId: made.id, superseded: previous?.id ?? null });
  return { allocationId: made.id, number: `RCA-${made.allocation_number}`, amount, capacityLeft: subMoney(line.value, addMoney(othersTotal, amount)), superseded: previous?.id ?? null };
}
// input: { reason } — the allocation ends; the line is the project's in full again only if no other project holds an allocation of it.
export async function endContractAllocation(client, c, allocationId, input = {}) {
  let id;
  try { id = uuid(allocationId, "Allocation"); } catch { throw revenueError(404, "PROJECT_REVENUE_SOURCE_MISSING"); }
  const row = (await client.query(`SELECT * FROM tenant.project_revenue_contract_allocations WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, id])).rows[0];
  if (!row) throw revenueError(404, "PROJECT_REVENUE_SOURCE_MISSING");
  const { can } = await revenueScope(client, c, row.project_id);
  if (!can.manageLinks) throw revenueError(403, "PROJECT_REVENUE_PERMISSION_DENIED");
  if (row.status !== "ACTIVE") return { allocationId: row.id, status: row.status, replayed: true };
  const reason = reasonOf(input);
  await client.query(`UPDATE tenant.project_revenue_contract_allocations SET status = 'CANCELLED', ended_by = $2, ended_at = clock_timestamp(), end_reason = $3 WHERE id = $1`, [row.id, c.userId ?? null, reason]);
  await projectEvent(client, c, row.project_id, "REVENUE_CONTRACT_ALLOCATION_ENDED", `RCA-${row.allocation_number} ended`, { allocationId: row.id, reason });
  return { allocationId: row.id, status: "CANCELLED" };
}

// input: { invoiceLineId, amount, contractAllocationId?, reason, commandId? } — the project's share of an issued invoice line (tax-exclusive).
export async function allocateInvoiceLine(client, c, projectId, input = {}) {
  const command = keyOf(input, "commandId") ?? keyOf(input);
  if (command) {
    const done = (await client.query(`SELECT id, allocation_number, allocated_net_amount FROM tenant.project_revenue_invoice_allocations WHERE organization_id = $1 AND command_id = $2`, [c.organizationId, command])).rows[0];
    if (done) return { allocationId: done.id, number: `RIA-${done.allocation_number}`, amount: String(done.allocated_net_amount), replayed: true };
  }
  const { project, can } = await revenueScope(client, c, projectId, { lock: true });
  if (!can.manageLinks) throw revenueError(403, "PROJECT_REVENUE_PERMISSION_DENIED");
  let lineId;
  try { lineId = uuid(input.invoiceLineId, "Invoice line"); } catch { throw revenueError(400, "PROJECT_REVENUE_INPUT_INVALID", "Choose the invoice line.", { field: "invoiceLineId" }); }
  const reason = reasonOf(input);
  const amount = amountOf(input.amount, "amount");
  await lock(client, lineId);
  const line = (await client.query(`SELECT line.id, line.net_amount, line.sequence, invoice.id AS invoice_id, invoice.invoice_number, invoice.invoice_type, invoice.status, invoice.party_id, invoice.content_hash,
        btrim(invoice.currency_code) AS currency, invoice.accounting_date, version.sales_order_id AS order_id, order_line.sequence AS order_sequence
      FROM tenant.accounting_customer_invoice_lines line JOIN tenant.accounting_customer_invoices invoice ON invoice.id = line.customer_invoice_id
      LEFT JOIN tenant.sales_order_lines order_line ON order_line.id = line.source_sales_order_line_id LEFT JOIN tenant.sales_order_versions version ON version.id = order_line.sales_order_version_id
     WHERE line.organization_id = $1 AND line.id = $2`, [c.organizationId, lineId])).rows[0];
  if (!line) throw revenueError(404, "PROJECT_REVENUE_SOURCE_MISSING");
  if (line.invoice_type !== "invoice" || !DOC_ISSUED.includes(line.status)) throw revenueError(409, "PROJECT_REVENUE_CONTRACT_INVALID", `${line.invoice_number} is ${line.status.replace(/_/g, " ")}: allocate lines of issued invoices only.`);
  if (!project.customer_id || line.party_id !== project.customer_id) throw revenueError(409, "PROJECT_REVENUE_CUSTOMER_MISMATCH");
  const related = (await client.query(`SELECT 1 FROM tenant.project_links link WHERE link.organization_id = $1 AND link.project_id = $2 AND link.removed_at IS NULL
      AND ((link.source_type = 'SALES_ORDER' AND link.source_id = $3) OR (link.source_type = 'SALES_INVOICE' AND link.source_id = $4)) LIMIT 1`, [c.organizationId, project.id, line.order_id, line.invoice_id])).rows[0];
  if (!related) throw revenueError(409, "PROJECT_REVENUE_CONTRACT_INVALID", `${line.invoice_number} bills an order that is not linked to the project.`);
  const locked = (await client.query(`SELECT locked_at FROM tenant.fiscal_periods WHERE organization_id = $1 AND start_date <= $2 AND end_date >= $2 AND locked_at IS NOT NULL LIMIT 1`, [c.organizationId, line.accounting_date])).rows[0];
  if (locked && !can.reconcile) throw revenueError(409, "PROJECT_REVENUE_PERIOD_CLOSED");
  let contractAllocationId = null;
  if (input.contractAllocationId) {
    contractAllocationId = uuid(input.contractAllocationId, "Contract allocation");
    const ok = (await client.query(`SELECT 1 FROM tenant.project_revenue_contract_allocations WHERE organization_id = $1 AND id = $2 AND project_id = $3 AND status = 'ACTIVE'`, [c.organizationId, contractAllocationId, project.id])).rows[0];
    if (!ok) throw revenueError(409, "PROJECT_REVENUE_CONTRACT_INVALID", "That contract allocation is not this project's current one.");
  }
  const others = (await client.query(`SELECT COALESCE(sum(allocated_net_amount), 0) AS total FROM tenant.project_revenue_invoice_allocations WHERE organization_id = $1 AND customer_invoice_line_id = $2 AND status = 'CURRENT' AND project_id <> $3`,
    [c.organizationId, lineId, project.id])).rows[0].total;
  const net = moneyOut(line.net_amount);
  const othersTotal = moneyOut(others);
  if (cmpMoney(addMoney(othersTotal, amount), net) > 0) throw revenueError(409, "PROJECT_REVENUE_INVOICE_OVERALLOCATED", `Only ${subMoney(net, othersTotal)} of the line's ${net} is left to allocate.`, { available: subMoney(net, othersTotal) });
  const previous = (await client.query(`UPDATE tenant.project_revenue_invoice_allocations SET status = 'REVERSED', reversed_by = $3, reversed_at = clock_timestamp(), reversal_reason = $4
      WHERE organization_id = $1 AND project_id = $2 AND customer_invoice_line_id = $5 AND status = 'CURRENT' RETURNING id`, [c.organizationId, project.id, c.userId ?? null, `Replaced: ${reason}`, lineId])).rows[0];
  const made = (await client.query(`INSERT INTO tenant.project_revenue_invoice_allocations (organization_id, project_id, customer_invoice_id, customer_invoice_line_id, contract_allocation_id, allocated_net_amount, currency,
        source_version, reason, command_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, allocation_number`,
  [c.organizationId, project.id, line.invoice_id, lineId, contractAllocationId, amount, line.currency || await baseCurrency(client, c), line.content_hash, reason, command, c.userId ?? null])).rows[0];
  await projectEvent(client, c, project.id, "REVENUE_INVOICE_ALLOCATED", `${line.invoice_number} line ${line.sequence}: ${amount}`, { allocationId: made.id, replaced: previous?.id ?? null });
  return { allocationId: made.id, number: `RIA-${made.allocation_number}`, amount, available: subMoney(net, addMoney(othersTotal, amount)), replaced: previous?.id ?? null };
}
export async function reverseInvoiceAllocation(client, c, allocationId, input = {}) {
  let id;
  try { id = uuid(allocationId, "Allocation"); } catch { throw revenueError(404, "PROJECT_REVENUE_SOURCE_MISSING"); }
  const row = (await client.query(`SELECT * FROM tenant.project_revenue_invoice_allocations WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, id])).rows[0];
  if (!row) throw revenueError(404, "PROJECT_REVENUE_SOURCE_MISSING");
  const { can } = await revenueScope(client, c, row.project_id);
  if (!can.manageLinks) throw revenueError(403, "PROJECT_REVENUE_PERMISSION_DENIED");
  if (row.status === "REVERSED") return { allocationId: row.id, status: "REVERSED", replayed: true };
  const reason = reasonOf(input);
  await client.query(`UPDATE tenant.project_revenue_invoice_allocations SET status = 'REVERSED', reversed_by = $2, reversed_at = clock_timestamp(), reversal_reason = $3 WHERE id = $1`, [row.id, c.userId ?? null, reason]);
  await projectEvent(client, c, row.project_id, "REVENUE_INVOICE_ALLOCATION_REVERSED", `RIA-${row.allocation_number} reversed`, { allocationId: row.id, reason });
  return { allocationId: row.id, status: "REVERSED" };
}

// input: { expectedFurtherRevenue, asOfDate?, assumptions, idempotencyKey? } — a manual forecast, kept as a new version, never mixed into contract figures.
export async function saveRevenueForecast(client, c, projectId, input = {}) {
  const key = keyOf(input);
  if (key) {
    const done = (await client.query(`SELECT version FROM tenant.project_revenue_forecasts WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { version: done.version, replayed: true };
  }
  const { project, can } = await revenueScope(client, c, projectId, { lock: true });
  if (!can.forecast) throw revenueError(403, "PROJECT_REVENUE_PERMISSION_DENIED");
  let expected;
  try { expected = money(input.expectedFurtherRevenue, "expectedFurtherRevenue", { allowZero: true }); } catch { throw revenueError(400, "PROJECT_REVENUE_INPUT_INVALID", "Enter the expected further revenue (0 or more).", { field: "expectedFurtherRevenue" }); }
  const assumptions = text(input.assumptions, 2000);
  if (assumptions.length < 3) throw revenueError(400, "PROJECT_REVENUE_INPUT_INVALID", "State the forecast's assumptions.", { field: "assumptions" });
  const asOf = input.asOfDate ? String(input.asOfDate).slice(0, 10) : (await client.query(`SELECT to_char(current_date, 'YYYY-MM-DD') AS d`)).rows[0].d;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw revenueError(400, "PROJECT_REVENUE_INPUT_INVALID", "Enter a valid date.", { field: "asOfDate" });
  const version = Number((await client.query(`SELECT COALESCE(max(version), 0) + 1 AS v FROM tenant.project_revenue_forecasts WHERE project_id = $1`, [project.id])).rows[0].v);
  await client.query(`INSERT INTO tenant.project_revenue_forecasts (organization_id, project_id, version, expected_further_revenue, currency, as_of_date, assumptions, created_by, idempotency_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [c.organizationId, project.id, version, expected, await baseCurrency(client, c), asOf, assumptions, c.userId ?? null, key]);
  await projectEvent(client, c, project.id, "REVENUE_FORECAST_SAVED", `Revenue forecast v${version}`, { version });
  return { version, expectedFurther: expected };
}
