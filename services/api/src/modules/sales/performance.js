// Commission rules, salesperson targets and performance (Sales audit, should-have).
//
//   commission rules   a rate on net sales or on margin, for one salesperson or everyone, between dates; confirming an order accrues the
//                      commission of the rule that applies (pass1-operations.js). Set up by whoever manages Sales settings.
//   targets            a monthly target of invoiced value (company currency) per salesperson — the same monthly targets as CRM's, a
//                      measure of its own.
//   performance        per salesperson for a month: target, invoiced (posted invoices less credit notes, in the company's currency, by the
//                      salesperson who owns the order), achievement, orders confirmed, margin (to those who may see margin) and commission.
//                      A salesperson sees their own; whoever sees every order sees everyone.
import { SalesError } from "./index.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-\d{2}$/;
const can = (c, permission) => Boolean(c.roleSlugs?.includes("organization_owner") || c.permissions?.includes(permission));
const need = (c, permission, message) => { if (!can(c, permission)) throw new SalesError(403, message ?? "You do not have permission to perform this Sales operation.", "PERMISSION_DENIED"); };
const invalid = (field, message) => new SalesError(400, message, "SALES_PERFORMANCE_INVALID", { issues: [{ field, message }] });
const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const day = (value) => (value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
  : value ? String(value).slice(0, 10) : null);
const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;

// ---- commission rules ---------------------------------------------------------------------------------------------------------------
const toRule = (row) => ({
  id: row.id, name: row.name, ownerUserId: row.owner_user_id, ownerName: row.owner_name ?? null, ratePercent: Number(row.rate_percent), basis: row.basis,
  basisLabel: row.basis === "gross_margin" ? "Margin" : "Net sales (before tax)", validFrom: day(row.valid_from), validTo: day(row.valid_to),
  status: row.status, isActive: row.status === "active", entries: Number(row.entries ?? 0),
});

export async function listCommissionRules(client, c) {
  need(c, "sales.view");
  const rows = (await client.query(
    `SELECT rule.*, owner.full_name AS owner_name, (SELECT count(*) FROM tenant.sales_commission_entries entry WHERE entry.rule_id = rule.id) AS entries
       FROM tenant.sales_commission_rules rule LEFT JOIN public.users owner ON owner.id = rule.owner_user_id
      WHERE rule.organization_id = $1 ORDER BY rule.status, rule.owner_user_id NULLS LAST, rule.created_at DESC`, [c.organizationId])).rows;
  return { rules: rows.map(toRule), canManage: can(c, "sales.settings.manage") };
}

// input: { name, ratePercent, basis ("net_sales" | "gross_margin"), ownerUserId? (empty: everyone), validFrom?, validTo? }; id to change one.
export async function saveCommissionRule(client, c, input = {}, ruleId = null) {
  need(c, "sales.settings.manage", "You do not have permission to set up commission.");
  const name = text(input.name, 120);
  if (!name) throw invalid("name", "Name the rule.");
  const rate = Number(input.ratePercent);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw invalid("ratePercent", "Enter a rate between 0 and 100%.");
  const basis = input.basis === "gross_margin" ? "gross_margin" : "net_sales";
  const owner = input.ownerUserId || null;
  if (owner && !(UUID.test(String(owner)) && (await client.query(
    "SELECT 1 FROM public.organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'", [c.organizationId, owner])).rows[0]))
    throw invalid("ownerUserId", "Choose an active member, or everyone.");
  const from = input.validFrom || null;
  const to = input.validTo || null;
  if (from && to && from > to) throw invalid("validTo", "The end date is before the start date.");
  if (ruleId) {
    const row = (await client.query(
      `UPDATE tenant.sales_commission_rules SET name = $3, rate_percent = $4, basis = $5, owner_user_id = $6, valid_from = $7, valid_to = $8, updated_by = $9, updated_at = now()
        WHERE organization_id = $1 AND id = $2 RETURNING id`, [c.organizationId, ruleId, name, rate, basis, owner, from, to, c.userId ?? null])).rows[0];
    if (!row) throw new SalesError(404, "Commission rule not found.", "SALES_COMMISSION_RULE_NOT_FOUND");
    return (await listCommissionRules(client, c)).rules.find((rule) => rule.id === row.id);
  }
  const row = (await client.query(
    `INSERT INTO tenant.sales_commission_rules (organization_id, name, rate_percent, basis, owner_user_id, valid_from, valid_to, status, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $8) RETURNING id`, [c.organizationId, name, rate, basis, owner, from, to, c.userId ?? null])).rows[0];
  return (await listCommissionRules(client, c)).rules.find((rule) => rule.id === row.id);
}

export async function setCommissionRuleStatus(client, c, ruleId, active) {
  need(c, "sales.settings.manage", "You do not have permission to set up commission.");
  const row = (await client.query("UPDATE tenant.sales_commission_rules SET status = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING id",
    [c.organizationId, ruleId, active ? "active" : "inactive", c.userId ?? null])).rows[0];
  if (!row) throw new SalesError(404, "Commission rule not found.", "SALES_COMMISSION_RULE_NOT_FOUND");
  return { id: row.id, isActive: Boolean(active) };
}

// ---- targets and performance --------------------------------------------------------------------------------------------------------
// input: { userId, month ("YYYY-MM"), target (company currency; 0 clears it) }
export async function setInvoicedTarget(client, c, input = {}) {
  need(c, "sales.settings.manage", "You do not have permission to set targets.");
  if (!UUID.test(String(input.userId ?? ""))) throw invalid("userId", "Choose the salesperson.");
  if (!MONTH.test(String(input.month ?? ""))) throw invalid("month", "Choose the month.");
  const target = Number(input.target);
  if (!Number.isFinite(target) || target < 0) throw invalid("target", "Enter a target of 0 or more.");
  const month = `${input.month}-01`;
  if (target === 0) {
    await client.query("DELETE FROM tenant.crm_sales_targets WHERE organization_id = $1 AND user_id = $2 AND month = $3 AND metric = 'invoiced_value'", [c.organizationId, input.userId, month]);
    return { userId: input.userId, month: input.month, target: null };
  }
  await client.query(
    `INSERT INTO tenant.crm_sales_targets (organization_id, user_id, month, metric, target, created_by, updated_by) VALUES ($1, $2, $3, 'invoiced_value', $4, $5, $5)
     ON CONFLICT (organization_id, user_id, month, metric) DO UPDATE SET target = EXCLUDED.target, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [c.organizationId, input.userId, month, target, c.userId ?? null]);
  return { userId: input.userId, month: input.month, target: money(target) };
}

// filters: { month ("YYYY-MM", this month by default) }
export async function getSalesPerformance(client, c, filters = {}) {
  need(c, "sales.view");
  const month = MONTH.test(String(filters.month ?? "")) ? `${filters.month}-01`
    : (await client.query("SELECT date_trunc('month', tenant.company_today())::date::text AS month")).rows[0].month;
  const everyone = can(c, "sales.order.view_all");
  const margin = can(c, "sales.margin.view");
  const rows = (await client.query(
    `WITH people AS (
        SELECT DISTINCT person.user_id FROM (
          SELECT owner_user_id AS user_id FROM tenant.sales_orders WHERE organization_id = $1 AND owner_user_id IS NOT NULL
          UNION SELECT user_id FROM tenant.crm_sales_targets WHERE organization_id = $1 AND month = $2::date AND metric = 'invoiced_value') person
         WHERE $3::boolean OR person.user_id = $4),
      billed AS (
        SELECT sales_order.owner_user_id AS user_id,
               sum(CASE WHEN invoice.invoice_type = 'credit_note' THEN -1 ELSE 1 END * (invoice.subtotal - invoice.discount_total) * COALESCE(invoice.exchange_rate, 1)) AS invoiced,
               sum(CASE WHEN invoice.invoice_type = 'credit_note' THEN -1 ELSE 1 END * line_margin.margin) AS margin,
               count(*) FILTER (WHERE invoice.invoice_type = 'invoice') AS invoices
          FROM tenant.accounting_customer_invoices invoice
          LEFT JOIN tenant.sales_credit_notes note ON note.customer_invoice_id = invoice.id
          JOIN tenant.sales_orders sales_order ON sales_order.organization_id = invoice.organization_id AND sales_order.id = COALESCE(invoice.source_sales_order_id, note.sales_order_id)
          CROSS JOIN LATERAL (-- Margin in the company's currency: the line's value at the invoice's rate less its standard cost (per base unit × base quantity).
                              SELECT COALESCE(sum(line.net_amount * COALESCE(invoice.exchange_rate, 1) - COALESCE(order_line.standard_cost, 0) * COALESCE(order_line.conversion_factor, 1) * line.quantity), 0) AS margin
                                FROM tenant.accounting_customer_invoice_lines line
                                LEFT JOIN tenant.sales_order_lines order_line ON order_line.id = line.source_sales_order_line_id
                               WHERE line.customer_invoice_id = invoice.id) line_margin
         WHERE invoice.organization_id = $1 AND invoice.posted_at IS NOT NULL AND invoice.status NOT IN ('cancelled', 'reversed', 'void')
           AND invoice.invoice_type IN ('invoice', 'credit_note') AND invoice.invoice_date >= $2::date AND invoice.invoice_date < ($2::date + interval '1 month')
         GROUP BY sales_order.owner_user_id),
      confirmed AS (
        SELECT owner_user_id AS user_id, count(*) AS orders FROM tenant.sales_orders
         WHERE organization_id = $1 AND confirmed_at IS NOT NULL AND lifecycle_status IN ('confirmed', 'closed')
           AND confirmed_at >= $2::date AND confirmed_at < ($2::date + interval '1 month') GROUP BY owner_user_id),
      earned AS (
        SELECT owner_user_id AS user_id, sum(commission_amount) AS commission FROM tenant.sales_commission_entries
         WHERE organization_id = $1 AND status <> 'reversed' AND created_at >= $2::date AND created_at < ($2::date + interval '1 month') GROUP BY owner_user_id)
     SELECT people.user_id, member.full_name, target.target, COALESCE(billed.invoiced, 0) AS invoiced, COALESCE(billed.margin, 0) AS margin, COALESCE(billed.invoices, 0) AS invoices,
            COALESCE(confirmed.orders, 0) AS orders, COALESCE(earned.commission, 0) AS commission
       FROM people JOIN public.users member ON member.id = people.user_id
       LEFT JOIN tenant.crm_sales_targets target ON target.organization_id = $1 AND target.user_id = people.user_id AND target.month = $2::date AND target.metric = 'invoiced_value'
       LEFT JOIN billed ON billed.user_id = people.user_id LEFT JOIN confirmed ON confirmed.user_id = people.user_id LEFT JOIN earned ON earned.user_id = people.user_id
      ORDER BY COALESCE(billed.invoiced, 0) DESC, member.full_name`,
    [c.organizationId, month, everyone, c.userId ?? null])).rows;
  const currency = String((await client.query("SELECT base_currency FROM public.organizations WHERE id = $1", [c.organizationId])).rows[0]?.base_currency ?? "INR").trim();
  return {
    month: month.slice(0, 7), currencyCode: currency, showsMargin: margin, canSetTargets: can(c, "sales.settings.manage"),
    rows: rows.map((row) => {
      const target = row.target == null ? null : money(row.target);
      const invoiced = money(row.invoiced);
      return {
        userId: row.user_id, name: row.full_name, target, invoiced, achievementPercent: target ? Math.round((invoiced / target) * 1000) / 10 : null,
        invoices: Number(row.invoices), orders: Number(row.orders), commission: money(row.commission),
        ...(margin ? { margin: money(row.margin), marginPercent: invoiced ? Math.round((Number(row.margin) / invoiced) * 1000) / 10 : null } : {}),
      };
    }),
  };
}
