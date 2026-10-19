// "Bring your data" (Shared Platform plan 5): the one guided path for moving a company in — masters, then opening stock, then
// opening balances, then open invoices and bills — with the cut-over date everything is as of. Each step shows how much is in
// already and links to the import or screen that does it; steps of apps the company does not use are left out.
import { hasSessionPermission } from "../../core/access/index.js";

const STEPS = Object.freeze([
  { key: "customers", stage: "Masters", label: "Customers", moduleKey: "sales", permission: "sales.customers.import", href: "/sales/customers/import",
    count: `SELECT count(*)::int AS n FROM tenant.business_parties WHERE organization_id = $1 AND party_type IN ('customer', 'both')` },
  { key: "suppliers", stage: "Masters", label: "Suppliers", moduleKey: "procurement", permission: "procurement.suppliers.import", href: "/procurement/suppliers/import",
    count: `SELECT count(*)::int AS n FROM tenant.business_parties WHERE organization_id = $1 AND party_type IN ('supplier', 'both')` },
  { key: "products", stage: "Masters", label: "Products and services", moduleKey: "stock", alsoModules: ["sales", "procurement"], permission: "products.import", href: "/inventory/items/import",
    count: `SELECT count(*)::int AS n FROM tenant.items WHERE organization_id = $1` },
  { key: "tax-rates", stage: "Masters", label: "Tax rates", moduleKey: "sales", alsoModules: ["procurement", "accounting"], permission: "tax.categories.manage", href: "/settings/data-import/tax.rates",
    count: `SELECT count(*)::int AS n FROM tenant.tax_categories WHERE organization_id = $1` },
  { key: "warehouses", stage: "Masters", label: "Warehouses and bins", moduleKey: "stock", permission: "warehouses.create", href: "/settings/data-import/stock.warehouses",
    count: `SELECT count(*)::int AS n FROM tenant.warehouses WHERE organization_id = $1` },
  { key: "accounts", stage: "Masters", label: "Chart of accounts", moduleKey: "accounting", permission: "accounting.settings.manage", href: "/settings/data-import/accounting.accounts",
    count: `SELECT count(*)::int AS n FROM tenant.accounting_accounts WHERE organization_id = $1` },
  { key: "employees", stage: "Masters", label: "Employees", moduleKey: "hr-payroll", permission: "hr_payroll.employee.manage", href: "/settings/data-import/hr.employees",
    count: `SELECT count(*)::int AS n FROM tenant.hr_employees WHERE organization_id = $1` },
  { key: "boms", stage: "Masters", label: "Bills of materials", moduleKey: "manufacturing", permission: "manufacturing.bom.create", href: "/settings/data-import/manufacturing.boms",
    count: `SELECT count(*)::int AS n FROM tenant.manufacturing_bom_masters WHERE organization_id = $1` },
  { key: "opening-stock", stage: "Opening stock", label: "Opening stock", moduleKey: "stock", permission: "stock.opening", href: "/inventory/opening-stock",
    count: `SELECT count(*)::int AS n FROM tenant.opening_stocks WHERE organization_id = $1 AND status = 'posted'` },
  { key: "opening-assets", stage: "Opening stock", label: "Assets already owned", moduleKey: "assets", permission: "assets.opening.create", href: "/assets/opening",
    count: `SELECT count(*)::int AS n FROM tenant.asset_opening_batches WHERE organization_id = $1 AND status IN ('APPROVED', 'CLOSED', 'LOCKED')` },
  { key: "opening-balances", stage: "Opening balances", label: "Opening balances (bank, cash, loans, capital)", moduleKey: "accounting", permission: "accounting.journal.create", href: "/accounting/opening-balances",
    count: `SELECT count(*)::int AS n FROM tenant.accounting_opening_balances WHERE organization_id = $1 AND status = 'posted'` },
  { key: "open-invoices", stage: "Open invoices", label: "What customers owe you", moduleKey: "accounting", permission: "accounting.receivables.manage", href: "/settings/data-import/accounting.open_invoices",
    count: `SELECT count(*)::int AS n FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND invoice_type = 'opening'` },
  { key: "open-bills", stage: "Open invoices", label: "What you owe suppliers", moduleKey: "accounting", permission: "accounting.payables.manage", href: "/settings/data-import/accounting.open_bills",
    count: `SELECT count(*)::int AS n FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND bill_type = 'opening'` },
]);

export async function getDataChecklist(client, session, accessibleModules) {
  const modules = new Set(accessibleModules ?? []);
  const cutover = (await client.query(`SELECT to_char(data_cutover_date, 'YYYY-MM-DD') AS d FROM public.organizations WHERE id = $1`, [session.organizationId])).rows[0]?.d ?? null;
  const steps = [];
  for (const step of STEPS) {
    if (![step.moduleKey, ...(step.alsoModules ?? [])].some((moduleKey) => modules.has(moduleKey))) continue;
    await client.query("SAVEPOINT data_checklist_step");
    let count = 0;
    try {
      count = (await client.query(step.count, [session.organizationId])).rows[0]?.n ?? 0;
      await client.query("RELEASE SAVEPOINT data_checklist_step");
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT data_checklist_step");
    }
    steps.push({ key: step.key, stage: step.stage, label: step.label, count, done: count > 0, href: step.href, allowed: hasSessionPermission(session, step.permission) });
  }
  return { cutoverDate: cutover, steps, done: steps.filter((step) => step.done).length, total: steps.length };
}

export async function setDataCutoverDate(client, session, value) {
  const date = value ? String(value).slice(0, 10) : null;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Object.assign(new Error("Use a date like 2026-04-01."), { status: 400, code: "DATA_CUTOVER_INVALID" });
  await client.query(`UPDATE public.organizations SET data_cutover_date = $2::date, updated_at = now() WHERE id = $1`, [session.organizationId, date]);
  return { cutoverDate: date };
}
