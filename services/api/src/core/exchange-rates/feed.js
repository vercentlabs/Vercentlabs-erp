// The daily reference-rate feed (Shared Platform plan 7): an operator may point EXCHANGE_RATE_FEED_URL at a JSON feed of reference rates
// (RBI / FBIL, or a provider that republishes them) shaped { "date": "YYYY-MM-DD", "base": "INR", "rates": { "USD": 83.12, "EUR": 90.4 } },
// where each rate is the rupees one unit of the currency buys. Once a day each company gets that day's rate for its active currencies
// (source "feed"); a rate typed by hand for the same day is never overwritten.
let cached = null;

export const exchangeRateFeedConfigured = (env = process.env) => Boolean(String(env.EXCHANGE_RATE_FEED_URL ?? "").trim());

export async function fetchReferenceRates({ env = process.env, fetchImpl = fetch, today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!exchangeRateFeedConfigured(env)) return null;
  if (cached?.day === today) return cached.feed;
  const response = await fetchImpl(env.EXCHANGE_RATE_FEED_URL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`The rate feed answered ${response.status}.`);
  const body = await response.json();
  const rates = Object.fromEntries(Object.entries(body?.rates ?? {}).filter(([code, rate]) => /^[A-Z]{3}$/.test(code) && Number(rate) > 0).map(([code, rate]) => [code, Number(rate)]));
  const feed = { date: /^\d{4}-\d{2}-\d{2}$/.test(String(body?.date ?? "")) ? body.date : today, base: String(body?.base ?? "INR").toUpperCase(), rates };
  cached = { day: today, feed };
  return feed;
}

// Worker (daily, in the company's transaction). Returns how many rates were written.
export async function applyReferenceRates(client, organizationId, options = {}) {
  const feed = await fetchReferenceRates(options);
  if (!feed || !Object.keys(feed.rates).length) return 0;
  const base = (await client.query(`SELECT base_currency FROM public.organizations WHERE id = $1`, [organizationId])).rows[0]?.base_currency?.trim();
  if (base !== feed.base) return 0;
  const currencies = (await client.query(`SELECT code FROM tenant.currencies WHERE organization_id = $1 AND status = 'active' AND code <> $2`, [organizationId, base])).rows.map((row) => String(row.code).trim());
  let written = 0;
  for (const code of currencies) {
    if (!feed.rates[code]) continue;
    const result = await client.query(
      `INSERT INTO tenant.exchange_rates (organization_id, from_currency_code, to_currency_code, rate_date, rate, source, status)
       VALUES ($1, $2, $3, $4::date, $5, 'feed', 'active')
       ON CONFLICT (organization_id, from_currency_code, to_currency_code, rate_date) DO UPDATE SET rate = EXCLUDED.rate, updated_at = now()
         WHERE tenant.exchange_rates.source = 'feed'`,
      [organizationId, code, base, feed.date, feed.rates[code]]);
    written += result.rowCount ?? 0;
  }
  return written;
}
