// A customer's ledger and the outstanding list, inside Sales (Sales audit M7): "how much does this party owe, and since when" is the
// salesperson's daily question, and a company without the Accounting app has nowhere else to ask it. Both read Finance's ledger — the same
// statement and aging Accounting shows — for the customers the person may see, to whoever may see customer financials.
import { getPartyAging, getPartyStatement } from "../../accounting/party-ledgers/party-ledgers.js";
import { canViewCustomerFinancials, customerScopeSql, requireCustomerPermission } from "./access.js";
import { CUSTOMER_PARTY_SQL, CUSTOMER_PERMISSIONS, CustomerError } from "./constants.js";
import { loadCustomerRow } from "./records.js";

// Finance reads on Sales' behalf: the Sales permission checked here authorises it.
const ledgerContext = (context) => ({ organizationId: context.organizationId, userId: context.userId ?? null, roleSlugs: [], permissions: ["accounting.view"] });

function requireFinancials(context) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.view, "You do not have permission to view customers.");
  if (!canViewCustomerFinancials(context)) throw new CustomerError(403, "You do not have permission to see customer balances.", "PERMISSION_DENIED");
}

// The customer's statement between two dates (the financial year so far by default): opening balance, every invoice, credit note,
// payment and refund with a running balance, and what is open by age.
export async function getCustomerLedger(client, context, customerId, filters = {}) {
  requireFinancials(context);
  const customer = await loadCustomerRow(client, context, customerId);
  try {
    return await getPartyStatement(client, ledgerContext(context), "receivable", customer.id, { from: filters.from || undefined, to: filters.to || undefined });
  } catch (error) {
    if (error?.name !== "AccountingError") throw error;
    throw new CustomerError(error.status ?? 400, error.message, error.code ?? "SALES_LEDGER_INVALID");
  }
}

// What each customer the person may see owes, by age (not yet due, 1–30, 31–60, 61–90, over 90 days), in the company's currency.
export async function getCustomerOutstanding(client, context, filters = {}) {
  requireFinancials(context);
  let aging;
  try {
    aging = await getPartyAging(client, ledgerContext(context), "receivable", { asOf: filters.asOf || undefined });
  } catch (error) {
    if (error?.name !== "AccountingError") throw error;
    throw new CustomerError(error.status ?? 400, error.message, error.code ?? "SALES_LEDGER_INVALID");
  }
  const values = [context.organizationId];
  const scope = customerScopeSql(context, values, "customer");
  const visible = new Set((await client.query(
    `SELECT customer.id FROM tenant.business_parties customer WHERE customer.organization_id = $1 AND ${CUSTOMER_PARTY_SQL("customer")}${scope}`, values)).rows.map((row) => row.id));
  const search = String(filters.search ?? "").trim().toLowerCase();
  const rows = aging.rows.filter((row) => visible.has(row.partyId) && (!search || `${row.name} ${row.code ?? ""}`.toLowerCase().includes(search)));
  const money = (value) => Math.round(value * 100) / 100;
  const totals = Object.fromEntries([...aging.buckets.map((bucket) => bucket.key), "credits", "net"].map((key) => [key, money(rows.reduce((sum, row) => sum + row[key], 0))]));
  const currency = (await client.query("SELECT base_currency FROM public.organizations WHERE id = $1", [context.organizationId])).rows[0]?.base_currency;
  return { asOf: aging.asOf, buckets: aging.buckets, rows, totals, currencyCode: String(currency ?? "INR").trim() };
}
