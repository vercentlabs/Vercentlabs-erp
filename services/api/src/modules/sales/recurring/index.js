// Recurring orders and invoices (Sales report Phase 3). A schedule on an order repeats it every 1, 3, 6 or 12 months on a day of the
// month, from a start date to an optional end: each run makes a new order like it (today's prices — repeatSalesOrder), confirms it,
// and — when the schedule makes invoices — bills and finalises it and can email it. Pause stops the runs and Resume picks up from the
// next date still ahead; End stops for good. The run log has one row per schedule and date, so a re-run or an overlapping tick makes
// nothing twice. A run that cannot finish is logged with its reason and the schedule's owner is told; the schedule carries on.
import { notifyRecordOwner } from "../../../core/platform/notifications/index.js";
import { createInvoicesForOrders, finaliseInvoicesInBulk, sendInvoicesInBulk } from "../bulk.js";
import { confirmSalesOrder } from "../order-confirmations/confirm.js";
import { assertOrderVisible, requireOrderPermission } from "../orders/access.js";
import { ORDER_PERMISSIONS } from "../orders/constants.js";
import { repeatSalesOrder } from "../orders/repeat.js";
import { companyToday } from "../today.js";
import { SalesError } from "../index.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTERVALS = { 1: "Every month", 3: "Every 3 months", 6: "Every 6 months", 12: "Every year" };
const invalid = (message, field) => new SalesError(400, message, "SALES_RECURRING_INVALID", { field });
// A date column comes back as local midnight: read its local parts, not UTC.
const day = (value) => (!value ? null : value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : String(value).slice(0, 10));

// The date `months` after `from`, on `dayOfMonth` (1–28, so every month has it).
export function addMonthsOnDay(from, months, dayOfMonth) {
  const [year, month] = day(from).split("-").map(Number);
  const total = year * 12 + (month - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
}

// The first run on or after `from`.
function firstRunFrom(from, dayOfMonth) {
  const sameMonth = `${day(from).slice(0, 8)}${String(dayOfMonth).padStart(2, "0")}`;
  return sameMonth >= day(from) ? sameMonth : addMonthsOnDay(from, 1, dayOfMonth);
}

const view = (row) => row && ({
  id: row.id, orderId: row.source_order_id, intervalMonths: row.interval_months, intervalLabel: INTERVALS[row.interval_months], dayOfMonth: row.day_of_month,
  startDate: day(row.start_date), endDate: day(row.end_date), nextRunDate: row.status === "active" ? day(row.next_run_date) : null, makes: row.makes, autoSend: row.auto_send,
  status: row.status, runs: row.runs, lastRunDate: day(row.last_run_date), lastError: row.last_error,
  ...(row.sales_order_number !== undefined ? { orderNumber: row.sales_order_number, customerName: row.customer_name, grandTotal: row.grand_total === undefined ? undefined : Number(row.grand_total) } : {}),
});

async function sourceOrder(client, context, orderId) {
  if (!UUID.test(String(orderId ?? ""))) throw new SalesError(404, "Sales order not found.", "SALES_ORDER_NOT_FOUND");
  await assertOrderVisible(client, context, orderId);
  const order = (await client.query("SELECT id, party_id, lifecycle_status FROM tenant.sales_orders WHERE organization_id = $1 AND id = $2", [context.organizationId, orderId])).rows[0];
  if (!order) throw new SalesError(404, "Sales order not found.", "SALES_ORDER_NOT_FOUND");
  return order;
}

// The order's schedule (the current one, or the last ended) and its last 24 runs.
export async function getRecurringSchedule(client, context, orderId) {
  requireOrderPermission(context, ORDER_PERMISSIONS.view, "You do not have permission to view sales orders.");
  await sourceOrder(client, context, orderId);
  const schedule = (await client.query(
    `SELECT * FROM tenant.sales_recurring_schedules WHERE organization_id = $1 AND source_order_id = $2 ORDER BY (status = 'ended'), created_at DESC LIMIT 1`,
    [context.organizationId, orderId])).rows[0] ?? null;
  const runs = schedule ? (await client.query(
    `SELECT run.run_date, run.sales_order_id, run.invoice_id, run.error, sales_order.sales_order_number, invoice.invoice_number
       FROM tenant.sales_recurring_runs run
       LEFT JOIN tenant.sales_orders sales_order ON sales_order.organization_id = run.organization_id AND sales_order.id = run.sales_order_id
       LEFT JOIN tenant.accounting_customer_invoices invoice ON invoice.organization_id = run.organization_id AND invoice.id = run.invoice_id
      WHERE run.organization_id = $1 AND run.schedule_id = $2 ORDER BY run.run_date DESC LIMIT 24`, [context.organizationId, schedule.id])).rows : [];
  return { schedule: view(schedule), runs: runs.map((run) => ({ runDate: day(run.run_date), orderId: run.sales_order_id, orderNumber: run.sales_order_number,
    invoiceId: run.invoice_id, invoiceNumber: run.invoice_number, error: run.error })) };
}

// Every schedule that is not ended, soonest first.
export async function listRecurringSchedules(client, context) {
  requireOrderPermission(context, ORDER_PERMISSIONS.view, "You do not have permission to view sales orders.");
  const rows = (await client.query(
    `SELECT schedule.*, sales_order.sales_order_number, party.display_name AS customer_name, version.grand_total
       FROM tenant.sales_recurring_schedules schedule
       JOIN tenant.sales_orders sales_order ON sales_order.organization_id = schedule.organization_id AND sales_order.id = schedule.source_order_id
       JOIN tenant.sales_order_versions version ON version.organization_id = sales_order.organization_id AND version.id = sales_order.current_version_id
       LEFT JOIN tenant.business_parties party ON party.organization_id = sales_order.organization_id AND party.id = sales_order.party_id
      WHERE schedule.organization_id = $1 AND schedule.status <> 'ended'
      ORDER BY (schedule.status = 'paused'), schedule.next_run_date, sales_order.sales_order_number LIMIT 500`, [context.organizationId])).rows;
  return { schedules: rows.map(view) };
}

function readSchedule(input) {
  const intervalMonths = Number(input.intervalMonths);
  if (!INTERVALS[intervalMonths]) throw invalid("Choose how often.", "intervalMonths");
  const dayOfMonth = Math.trunc(Number(input.dayOfMonth));
  if (!(dayOfMonth >= 1 && dayOfMonth <= 28)) throw invalid("Choose a day from 1 to 28.", "dayOfMonth");
  const startDate = day(input.startDate);
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw invalid("Choose the start date.", "startDate");
  const endDate = day(input.endDate);
  if (endDate && endDate < startDate) throw invalid("The end date is before the start date.", "endDate");
  const makes = input.makes === "invoice" ? "invoice" : "order";
  return { intervalMonths, dayOfMonth, startDate, endDate, makes, autoSend: makes === "invoice" && input.autoSend === true };
}

// input: { intervalMonths, dayOfMonth, startDate, endDate?, makes: "order" | "invoice", autoSend? }. Creates the order's schedule or
// changes the one it has (not an ended one: that starts a new schedule). The next run is the first date on or after the later of the
// start and today.
export async function saveRecurringSchedule(client, context, orderId, input = {}) {
  requireOrderPermission(context, ORDER_PERMISSIONS.create, "You do not have permission to create sales orders.");
  const order = await sourceOrder(client, context, orderId);
  if (order.lifecycle_status === "cancelled") throw new SalesError(409, "A cancelled order cannot be repeated.", "SALES_RECURRING_SOURCE");
  const values = readSchedule(input);
  const today = await companyToday(client);
  const next = firstRunFrom(values.startDate > today ? values.startDate : today, values.dayOfMonth);
  const existing = (await client.query("SELECT id FROM tenant.sales_recurring_schedules WHERE organization_id = $1 AND source_order_id = $2 AND status <> 'ended' FOR UPDATE",
    [context.organizationId, order.id])).rows[0];
  const params = [values.intervalMonths, values.dayOfMonth, values.startDate, values.endDate, values.makes, values.autoSend, next];
  const row = existing
    ? (await client.query(`UPDATE tenant.sales_recurring_schedules SET interval_months = $3, day_of_month = $4, start_date = $5, end_date = $6, makes = $7, auto_send = $8,
          next_run_date = $9, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING *`, [context.organizationId, existing.id, ...params])).rows[0]
    : (await client.query(`INSERT INTO tenant.sales_recurring_schedules (organization_id, source_order_id, party_id, interval_months, day_of_month, start_date, end_date, makes,
          auto_send, next_run_date, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [context.organizationId, order.id, order.party_id, ...params, context.userId ?? null])).rows[0];
  return { schedule: view(row) };
}

// action: "pause" | "resume" | "end".
export async function setRecurringScheduleStatus(client, context, scheduleId, action) {
  requireOrderPermission(context, ORDER_PERMISSIONS.create, "You do not have permission to create sales orders.");
  if (!UUID.test(String(scheduleId ?? ""))) throw new SalesError(404, "Schedule not found.", "SALES_RECURRING_NOT_FOUND");
  const schedule = (await client.query("SELECT * FROM tenant.sales_recurring_schedules WHERE organization_id = $1 AND id = $2 FOR UPDATE", [context.organizationId, scheduleId])).rows[0];
  if (!schedule) throw new SalesError(404, "Schedule not found.", "SALES_RECURRING_NOT_FOUND");
  await assertOrderVisible(client, context, schedule.source_order_id);
  if (schedule.status === "ended") throw new SalesError(409, "This schedule has ended. Set up a new one.", "SALES_RECURRING_ENDED");
  let status = schedule.status;
  let next = day(schedule.next_run_date);
  if (action === "pause") status = "paused";
  else if (action === "end") status = "ended";
  else if (action === "resume") {
    status = "active";
    // Dates missed while paused are skipped.
    const today = await companyToday(client);
    while (next < today) next = addMonthsOnDay(next, schedule.interval_months, schedule.day_of_month);
  } else throw invalid("Choose pause, resume or end.", "action");
  const row = (await client.query("UPDATE tenant.sales_recurring_schedules SET status = $3, next_run_date = $4, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING *",
    [context.organizationId, schedule.id, status, next])).rows[0];
  return { schedule: view(row) };
}

async function savepoint(client, work) {
  await client.query("SAVEPOINT sales_recurring_run");
  try {
    const result = await work();
    await client.query("RELEASE SAVEPOINT sales_recurring_run");
    return { ok: true, result };
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT sales_recurring_run");
    return { ok: false, error: String(error?.message ?? error) };
  }
}

// The daily run (worker job sales.automation.recurring). systemContext: { organizationId }. options.renderPdf(context, invoiceId) →
// { fileName, content } for schedules that email the invoice; options.afterFinal(context, invoiceId) for the IRN. Each due schedule runs
// once for its date, as the person who set it up (with an owner's reach, as a system job). Returns { ran, failed }.
export async function runRecurringSchedules(client, systemContext, options = {}) {
  const today = options.today ?? (await companyToday(client));
  const due = (await client.query(
    `SELECT * FROM tenant.sales_recurring_schedules WHERE organization_id = $1 AND status = 'active' AND next_run_date <= $2 ORDER BY next_run_date FOR UPDATE SKIP LOCKED`,
    [systemContext.organizationId, today])).rows;
  let ran = 0;
  let failed = 0;
  for (const schedule of due) {
    const runDate = day(schedule.next_run_date);
    const following = addMonthsOnDay(runDate, schedule.interval_months, schedule.day_of_month);
    const finished = schedule.end_date && following > day(schedule.end_date);
    if (schedule.end_date && runDate > day(schedule.end_date)) {
      await client.query("UPDATE tenant.sales_recurring_schedules SET status = 'ended', updated_at = now() WHERE id = $1", [schedule.id]);
      continue;
    }
    const claimed = (await client.query(
      `INSERT INTO tenant.sales_recurring_runs (organization_id, schedule_id, run_date) VALUES ($1, $2, $3) ON CONFLICT (schedule_id, run_date) DO NOTHING RETURNING id`,
      [schedule.organization_id, schedule.id, runDate])).rows[0];
    const context = { organizationId: schedule.organization_id, userId: schedule.created_by ?? null, roleSlugs: ["organization_owner"], permissions: [] };
    let outcome = { ok: true, result: {} };
    if (claimed) {
      outcome = await savepoint(client, async () => {
        const made = await repeatSalesOrder(client, context, { orderId: schedule.source_order_id, idempotencyKey: `recurring:${schedule.id}:${runDate}` });
        const orderId = made.orderId ?? made.id;
        const confirmed = await confirmSalesOrder(client, context, orderId, {});
        if (confirmed.confirmed === false) throw new SalesError(409, (confirmed.problems ?? []).join(" ") || "The order could not be confirmed.", "SALES_RECURRING_NOT_CONFIRMED");
        if (schedule.makes !== "invoice") return { orderId };
        const billed = (await createInvoicesForOrders(client, context, { orderIds: [orderId], idempotencyKey: `recurring:${schedule.id}:${runDate}` })).results[0];
        if (!billed?.invoiceId) throw new SalesError(409, billed?.error ?? "The invoice could not be made.", "SALES_RECURRING_NOT_BILLED");
        const final = (await finaliseInvoicesInBulk(client, context, { invoiceIds: [billed.invoiceId], idempotencyKey: `recurring:${schedule.id}:${runDate}` },
          { afterFinal: options.afterFinal ? (invoiceId) => options.afterFinal(context, invoiceId) : undefined })).results[0];
        if (final?.error) throw new SalesError(409, final.error, "SALES_RECURRING_NOT_FINAL");
        if (schedule.auto_send && options.renderPdf) {
          const sent = (await sendInvoicesInBulk(client, context, { invoiceIds: [billed.invoiceId], idempotencyKey: `recurring:${schedule.id}:${runDate}` },
            { renderPdf: (invoiceId) => options.renderPdf(context, invoiceId) })).results[0];
          // Not emailed (no address, mail down): the invoice stands; the reason is kept.
          return { orderId, invoiceId: billed.invoiceId, warning: sent?.error ?? null };
        }
        return { orderId, invoiceId: billed.invoiceId };
      });
      const error = outcome.ok ? outcome.result.warning ?? null : outcome.error;
      await client.query("UPDATE tenant.sales_recurring_runs SET sales_order_id = $2, invoice_id = $3, error = $4 WHERE id = $1",
        [claimed.id, outcome.ok ? outcome.result.orderId : null, outcome.ok ? outcome.result.invoiceId ?? null : null, error]);
      if (outcome.ok) ran += 1; else failed += 1;
      if (error) {
        const order = (await client.query("SELECT sales_order_number FROM tenant.sales_orders WHERE id = $1", [schedule.source_order_id])).rows[0];
        await notifyRecordOwner(client, context, { userId: schedule.created_by, category: "sales_document",
          title: outcome.ok ? `The repeat of ${order?.sales_order_number ?? "an order"} was not emailed` : `The repeat of ${order?.sales_order_number ?? "an order"} could not be made`,
          message: error, href: `/sales/orders/${schedule.source_order_id}`, entityType: "sales_order", entityId: schedule.source_order_id }).catch(() => {});
      }
    }
    await client.query(
      `UPDATE tenant.sales_recurring_schedules SET next_run_date = $2, status = CASE WHEN $3 THEN 'ended' ELSE status END, runs = runs + $4, last_run_date = $5,
          last_error = $6, updated_at = now() WHERE id = $1`,
      [schedule.id, following, Boolean(finished), claimed && outcome.ok ? 1 : 0, runDate, claimed ? (outcome.ok ? outcome.result.warning ?? null : outcome.error) : schedule.last_error]);
  }
  return { ran, failed };
}
