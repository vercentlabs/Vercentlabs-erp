// Exchange rates (Settings → Finance & commercial → Exchange rates): the dated rates that convert an amount in one of the
// organization's currencies into another — usually into the base currency, which every cross-currency total (CRM pipeline and
// dashboards, stock valuation) is reported in. A rate is kept per day: the latest active rate on or before a date applies to it.
// Setting a day's rate again replaces it; a rate is never deleted, only deactivated (an inactive rate is skipped).
export const EXCHANGE_RATE_PERMISSIONS = Object.freeze({ view: "exchange_rates.view", manage: "exchange_rates.manage" });

export class ExchangeRateError extends Error {
  constructor(status, message, code = "EXCHANGE_RATE_ERROR", details = undefined) {
    super(message);
    this.name = "ExchangeRateError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^[A-Z]{3}$/;
const can = (context, permission) => Boolean(context.roleSlugs?.some((slug) => slug === "organization_owner" || slug === "system_administrator") || context.permissions?.includes(permission));
function requirePermission(context, permission, message) {
  if (!can(context, permission)) throw new ExchangeRateError(403, message, "PERMISSION_DENIED");
}
const invalid = (field, message) => new ExchangeRateError(400, message, "EXCHANGE_RATE_VALIDATION", { field });

const toRate = (row) => ({
  id: row.id,
  fromCurrencyCode: String(row.from_currency_code).trim(),
  fromCurrencyName: row.from_currency_name ?? null,
  toCurrencyCode: String(row.to_currency_code).trim(),
  rateDate: row.rate_day,
  rate: Number(row.rate),
  source: row.source,
  status: row.status,
  updatedAt: row.updated_at,
  updatedByName: row.updated_by_name ?? null,
});

const SELECT = `
  SELECT rate.*, to_char(rate.rate_date, 'YYYY-MM-DD') AS rate_day, currency.name AS from_currency_name, updater.full_name AS updated_by_name
    FROM tenant.exchange_rates rate
    LEFT JOIN tenant.currencies currency ON currency.organization_id = rate.organization_id AND currency.code = rate.from_currency_code
    LEFT JOIN public.users updater ON updater.id = rate.updated_by`;

async function baseCurrencyOf(client, context) {
  const { rows } = await client.query("SELECT base_currency FROM public.organizations WHERE id = $1", [context.organizationId]);
  return String(rows[0]?.base_currency ?? "INR").trim();
}

// filters: currency (from-currency code), status (active | inactive | all; default active)
export async function listExchangeRates(client, context, filters = {}) {
  requirePermission(context, EXCHANGE_RATE_PERMISSIONS.view, "You do not have permission to view exchange rates.");
  const values = [context.organizationId];
  const where = ["rate.organization_id = $1"];
  const status = ["active", "inactive", "all"].includes(filters.status) ? filters.status : "active";
  if (status !== "all") { values.push(status); where.push(`rate.status = $${values.length}`); }
  const currency = String(filters.currency ?? "").trim().toUpperCase();
  if (CODE.test(currency)) { values.push(currency); where.push(`rate.from_currency_code = $${values.length}`); }
  const { rows } = await client.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY rate.rate_date DESC, rate.from_currency_code LIMIT 500`, values);
  const baseCurrency = await baseCurrencyOf(client, context);
  // The rate in force today for each currency, and the currencies with none (their amounts cannot be added into the base currency).
  const latest = (await client.query(
    `SELECT DISTINCT ON (currency.code) currency.code, currency.name, rate.rate, to_char(rate.rate_date, 'YYYY-MM-DD') AS rate_day
       FROM tenant.currencies currency
       LEFT JOIN tenant.exchange_rates rate ON rate.organization_id = currency.organization_id AND rate.from_currency_code = currency.code
             AND rate.to_currency_code = $2 AND rate.status = 'active' AND rate.rate_date <= current_date
      WHERE currency.organization_id = $1 AND currency.status = 'active' AND currency.code <> $2
      ORDER BY currency.code, rate.rate_date DESC NULLS LAST`,
    [context.organizationId, baseCurrency],
  )).rows;
  return {
    baseCurrency,
    rates: rows.map(toRate),
    currencies: latest.map((row) => ({ code: String(row.code).trim(), name: row.name, currentRate: row.rate === null ? null : Number(row.rate), currentRateDate: row.rate_day ?? null })),
    can: { manage: can(context, EXCHANGE_RATE_PERMISSIONS.manage) },
  };
}

// input: { fromCurrencyCode, toCurrencyCode? (default the base currency), rateDate (YYYY-MM-DD), rate (> 0) }. Sets the rate for that
// day, replacing any rate already set for it.
export async function setExchangeRate(client, context, input = {}) {
  requirePermission(context, EXCHANGE_RATE_PERMISSIONS.manage, "You do not have permission to change exchange rates.");
  const baseCurrency = await baseCurrencyOf(client, context);
  const from = String(input.fromCurrencyCode ?? "").trim().toUpperCase();
  const to = String(input.toCurrencyCode ?? baseCurrency).trim().toUpperCase();
  if (!CODE.test(from)) throw invalid("fromCurrencyCode", "Choose the currency the rate converts from.");
  if (!CODE.test(to)) throw invalid("toCurrencyCode", "Choose the currency the rate converts to.");
  if (from === to) throw invalid("fromCurrencyCode", "A rate converts between two different currencies.");
  const day = String(input.rateDate ?? "").trim();
  if (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) throw invalid("rateDate", "Enter the date the rate applies from.");
  const rate = Number(input.rate);
  if (!Number.isFinite(rate) || rate <= 0) throw invalid("rate", "Enter a rate greater than zero.");
  if (rate >= 1e14) throw invalid("rate", "The rate is too large.");
  const known = (await client.query(
    "SELECT code FROM tenant.currencies WHERE organization_id = $1 AND code = ANY ($2::text[]) AND status = 'active'", [context.organizationId, [from, to]])).rows.map((row) => String(row.code).trim());
  for (const [field, code] of [["fromCurrencyCode", from], ["toCurrencyCode", to]])
    if (!known.includes(code) && code !== baseCurrency) throw invalid(field, `${code} is not one of your organization's active currencies.`);
  const { rows } = await client.query(
    `INSERT INTO tenant.exchange_rates (organization_id, from_currency_code, to_currency_code, rate_date, rate, source, status, created_by, updated_by)
     VALUES ($1, $2, $3, $4::date, $5, 'manual', 'active', $6, $6)
     ON CONFLICT (organization_id, from_currency_code, to_currency_code, rate_date)
     DO UPDATE SET rate = EXCLUDED.rate, status = 'active', source = 'manual', updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING id`,
    [context.organizationId, from, to, day, rate, context.userId ?? null],
  );
  return getExchangeRate(client, context, rows[0].id);
}

export async function getExchangeRate(client, context, rateId) {
  requirePermission(context, EXCHANGE_RATE_PERMISSIONS.view, "You do not have permission to view exchange rates.");
  if (!UUID.test(String(rateId ?? ""))) throw new ExchangeRateError(404, "Exchange rate not found.", "EXCHANGE_RATE_NOT_FOUND");
  const { rows } = await client.query(`${SELECT} WHERE rate.organization_id = $1 AND rate.id = $2`, [context.organizationId, rateId]);
  if (!rows[0]) throw new ExchangeRateError(404, "Exchange rate not found.", "EXCHANGE_RATE_NOT_FOUND");
  return toRate(rows[0]);
}

// status: active | inactive. An inactive rate is skipped: the one before it applies again.
export async function setExchangeRateStatus(client, context, rateId, status) {
  requirePermission(context, EXCHANGE_RATE_PERMISSIONS.manage, "You do not have permission to change exchange rates.");
  if (!["active", "inactive"].includes(status)) throw invalid("status", "Choose active or inactive.");
  const current = await getExchangeRate(client, context, rateId);
  if (current.status !== status)
    await client.query("UPDATE tenant.exchange_rates SET status = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2",
      [context.organizationId, rateId, status, context.userId ?? null]);
  return getExchangeRate(client, context, rateId);
}
