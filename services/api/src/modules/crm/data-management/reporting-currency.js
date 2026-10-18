// Money totals across deals, in the organization's base (reporting) currency. A deal keeps its own currency; to add deals
// together each amount is converted with tenant.exchange_rates (the dated rate table Accounting uses): the latest active
// rate on or before the valuation date — the close date for a won or lost deal, the organization's today for an open one.
// A deal in a currency with no rate is never added at face value: its rate is NULL, so it drops out of every sum and is
// reported as unconverted instead. analytics/opportunity-facts.js applies the same rule.
import { orgToday } from "./org-date.js";

// SQL: the rate from `currency` to the base currency of `organization` on `day` — 1 for the base currency, NULL when no rate exists.
export const reportingRate = (organization, currency, day) => `(SELECT CASE WHEN COALESCE(${currency}, base_org.base_currency) = base_org.base_currency THEN 1::numeric
      ELSE (SELECT fx.rate FROM tenant.exchange_rates fx
             WHERE fx.organization_id = base_org.id AND fx.from_currency_code = ${currency} AND fx.to_currency_code = base_org.base_currency
               AND fx.status = 'active' AND fx.rate_date <= ${day}
             ORDER BY fx.rate_date DESC LIMIT 1) END
    FROM public.organizations base_org WHERE base_org.id = ${organization})`;

// SQL: a deal's valuation date.
export const valuationDate = (deal) => `(CASE WHEN ${deal}.status IN ('won', 'lost') THEN COALESCE(${deal}.actual_close_date, ${orgToday(`${deal}.organization_id`)}) ELSE ${orgToday(`${deal}.organization_id`)} END)`;

// SQL: the rate for one deal row (alias `deal`, a tenant.crm_opportunities row).
export const dealRate = (deal) => reportingRate(`${deal}.organization_id`, `${deal}.currency_code`, valuationDate(deal));

// SQL aggregates for a deal set whose rows carry `amount`, `probability`, `won_amount`, `currency_code` and a `reporting_rate`
// column (OPPORTUNITY_SELECT has one). `where` narrows the rows counted.
const filtered = (where) => (where ? ` FILTER (WHERE ${where})` : "");
export const sumReporting = (alias, where = "") => `COALESCE(sum(${alias}.amount * ${alias}.reporting_rate)${filtered(where)}, 0)::float8`;
export const sumWeightedReporting = (alias, where = "") => `COALESCE(sum(${alias}.amount * ${alias}.probability / 100 * ${alias}.reporting_rate)${filtered(where)}, 0)::float8`;
export const sumWonReporting = (alias, where = "") => `COALESCE(sum(COALESCE(${alias}.won_amount, ${alias}.amount) * ${alias}.reporting_rate)${filtered(where)}, 0)::float8`;
export const unconvertedCount = (alias, where = "") => `count(*) FILTER (WHERE ${alias}.reporting_rate IS NULL${where ? ` AND (${where})` : ""})::int`;
export const unconvertedCurrencies = (alias, where = "") =>
  `COALESCE(array_agg(DISTINCT ${alias}.currency_code) FILTER (WHERE ${alias}.reporting_rate IS NULL${where ? ` AND (${where})` : ""}), '{}')`;

// The disclosure every money total carries: the currency it is in and the deals left out of it.
export async function reportingCurrencyOf(client, organizationId) {
  const { rows } = await client.query("SELECT base_currency FROM public.organizations WHERE id = $1", [organizationId]);
  return rows[0]?.base_currency ?? null;
}
export const currencyDisclosure = (reportingCurrency, row) => ({
  reportingCurrency,
  unconvertedCount: Number(row?.unconverted_count ?? 0),
  unconvertedCurrencies: (row?.unconverted_currencies ?? []).map((code) => String(code).trim()).filter(Boolean),
});
