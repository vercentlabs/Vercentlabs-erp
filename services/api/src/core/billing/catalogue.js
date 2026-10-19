// Commercial catalogue and pricing.
//
//   Free      1 user and 1 app of the company's choice, ₹0, no payment details (billing_plans.module_allowance = 1).
//   Standard  ₹699 per user per month, or ₹499 per user per month billed yearly (₹5,988 per user per year); every app; every user
//             is paid (no included user). Razorpay quantity = the number of users.
//   Custom    plan code `enterprise` (historical): all apps, contracted, never bought online.
//
// Prices are quoted before GST. GST (18%, BILLING_GST_RATE_PERCENT) is added to what Razorpay charges unless
// BILLING_PRICES_INCLUDE_GST=true. Vercentlabs' tax invoice for every charge splits it back out (tax-invoices.js).
//
// Commercial terms live on immutable price VERSIONS (billing_plan_prices; the database refuses to change one). A plan can have one
// active version per billing period; new checkout uses it, historical subscriptions keep theirs.
import { BillingServiceError } from "./errors.js";

export const BILLING_PERIODS = Object.freeze(["monthly", "yearly"]);

export const COMMERCIAL_MODEL = Object.freeze({
  currency: "INR",
  free: Object.freeze({ code: "free", includedUsers: 1, pricePaise: 0, moduleAllowance: 1 }),
  standard: Object.freeze({ code: "standard", includedUsers: 0, perUserMonthlyPaise: 69900, perUserYearlyPaise: 598800 }),
  custom: Object.freeze({ code: "enterprise" }),
});

export const MAX_SEATED_USERS = 500;

export function gstRatePercent(env = process.env) {
  const rate = Number(env.BILLING_GST_RATE_PERCENT ?? 18);
  return Number.isFinite(rate) && rate >= 0 && rate <= 40 ? rate : 18;
}

export function pricesIncludeGst(env = process.env) {
  return String(env.BILLING_PRICES_INCLUDE_GST || "").toLowerCase() === "true";
}

// What the payment provider charges for one user for one period, in paise: the price, plus GST when prices are quoted before GST.
export function chargedPerUserPaise(pricePaise, env = process.env) {
  const price = Number(pricePaise);
  if (pricesIncludeGst(env)) return price;
  return Math.round((price * (100 + gstRatePercent(env))) / 100);
}

// Pure pricing: integer paise only. The server computes every authoritative amount.
export function calculateSeatCharge({ includedUsers, perUserPaise, totalUsers, env = process.env }) {
  const included = Number(includedUsers ?? 0);
  const total = Number(totalUsers);
  const perUser = Number(perUserPaise);
  if (!Number.isInteger(total) || total < 1) throw new BillingServiceError(422, "Enter a whole number of users.", "BILLING_USERS_INVALID");
  if (!Number.isInteger(included) || included < 0 || !Number.isSafeInteger(perUser) || perUser < 0) {
    throw new BillingServiceError(500, "The price version is not valid.", "BILLING_PRICE_INVALID");
  }
  const billableSeats = Math.max(0, total - included);
  const pricePaise = billableSeats * perUser;
  const chargedPaise = billableSeats * chargedPerUserPaise(perUser, env);
  // monthlyPaise is kept for the older callers; for a yearly price it is the yearly amount.
  return { totalUsers: total, includedUsers: included, billableSeats, pricePaise, chargedPaise, gstPaise: chargedPaise - pricePaise, monthlyPaise: pricePaise };
}

// The active price version of a plan for a billing period (monthly by default; Custom has its own "custom" period).
export async function currentPrice(client, planCode, billingPeriod = null) {
  const rows = await client.query(
    `SELECT price.id AS price_id, price.amount_paise, price.currency, price.billing_period, price.version, price.provider_plan_id,
            price.included_users, plan.code, plan.name, plan.availability, plan.pricing_model, plan.status, plan.modules, plan.limits,
            plan.module_allowance
       FROM billing_plan_prices price JOIN billing_plans plan ON plan.id = price.plan_id
      WHERE plan.code = $1 AND price.active AND plan.status = 'active'
        AND ($2::text IS NULL OR price.billing_period = $2 OR (price.billing_period = 'custom' AND plan.pricing_model = 'custom'))
      ORDER BY (price.billing_period = 'monthly') DESC, price.version DESC LIMIT 1`,
    [planCode, billingPeriod],
  );
  return rows.rows[0] || null;
}

export function salesContact(env = process.env) {
  const url = String(env.BILLING_SALES_CONTACT_URL || "").trim();
  return /^(https:\/\/|mailto:)[^\s"<>]+$/i.test(url) ? url : null;
}

// One entry per public plan; a plan sold monthly and yearly carries both prices (`prices.monthly`, `prices.yearly`).
export async function listPlanCatalogue(client, organizationId = null, env = process.env) {
  const rows = await client.query(
    `SELECT price.id AS price_id, price.amount_paise, price.currency, price.billing_period, price.included_users AS price_included_users,
            plan.code, plan.name, plan.description, plan.features, plan.availability, plan.pricing_model, plan.included_users, plan.module_allowance,
            plan.display_order
       FROM billing_plans plan
       JOIN billing_plan_prices price ON price.plan_id = plan.id AND price.active AND price.billing_period IN ('monthly', 'yearly', 'custom')
      WHERE plan.status = 'active' AND plan.is_public
      ORDER BY plan.display_order, price.billing_period`,
  );
  const current = organizationId
    ? (await client.query(
        `SELECT plan.code, s.billing_period FROM organization_subscriptions s JOIN billing_plan_prices price ON price.id = s.plan_price_id
           JOIN billing_plans plan ON plan.id = price.plan_id WHERE s.organization_id = $1`,
        [organizationId],
      )).rows[0]
    : null;
  const checkoutEnabled = String(env.BILLING_CHECKOUT_ENABLED || "").toLowerCase() === "true";
  const plans = new Map();
  for (const row of rows.rows) {
    let plan = plans.get(row.code);
    if (!plan) {
      plan = {
        priceId: row.price_id,
        code: row.code,
        name: row.name,
        description: row.description,
        features: Array.isArray(row.features) ? row.features : [],
        availability: row.availability,
        pricingModel: row.pricing_model,
        includedUsers: row.price_included_users ?? row.included_users,
        moduleAllowance: row.module_allowance ?? null,
        perUserPricePaise: null,
        currency: row.currency,
        prices: {},
        pricesIncludeGst: pricesIncludeGst(env),
        gstRatePercent: gstRatePercent(env),
        current: current?.code === row.code,
        currentBillingPeriod: current?.code === row.code ? current.billing_period : null,
        purchasable: row.availability === "available" && row.pricing_model === "per_seat" && checkoutEnabled,
        contactSales: row.availability === "contact_sales",
        salesContactUrl: row.availability === "contact_sales" ? salesContact(env) : null,
      };
      plans.set(row.code, plan);
    }
    if (row.pricing_model === "per_seat" && BILLING_PERIODS.includes(row.billing_period)) {
      const amount = Number(row.amount_paise);
      plan.prices[row.billing_period] = {
        priceId: row.price_id,
        perUserPaise: amount,
        perUserMonthlyPaise: row.billing_period === "yearly" ? Math.round(amount / 12) : amount,
        perUserChargedPaise: chargedPerUserPaise(amount, env),
      };
      if (row.billing_period === "monthly" || plan.perUserPricePaise === null) {
        plan.perUserPricePaise = amount;
        plan.priceId = row.price_id;
      }
    }
  }
  return [...plans.values()];
}

export function buildProviderPlanPayload(price, env = process.env) {
  if (!Number.isSafeInteger(Number(price.amount_paise)) || Number(price.amount_paise) <= 0) {
    throw new BillingServiceError(500, "A positive recurring price is required.", "BILLING_PRICE_INVALID");
  }
  if (!BILLING_PERIODS.includes(price.billing_period)) throw new BillingServiceError(500, "Only monthly and yearly prices are sold online.", "BILLING_PRICE_INVALID");
  const yearly = price.billing_period === "yearly";
  const included = pricesIncludeGst(env);
  return {
    period: yearly ? "yearly" : "monthly",
    interval: 1,
    item: {
      name: `${price.name} - per user, ${yearly ? "yearly" : "monthly"} (v${price.version})`,
      description: `${price.name}: one user, billed ${yearly ? "yearly" : "monthly"}${included ? "" : `, including ${gstRatePercent(env)}% GST`}`,
      amount: chargedPerUserPaise(price.amount_paise, env),
      currency: price.currency || "INR",
    },
    notes: {
      vercentlabs_plan_code: price.code, vercentlabs_price_id: price.price_id, vercentlabs_price_version: String(price.version),
      vercentlabs_billing_period: price.billing_period, vercentlabs_gst_included_in_price: String(included),
    },
  };
}

// Each price version gets exactly one provider plan, linked permanently.
// Plan creation is an HTTP call made OUTSIDE any transaction; the link is a
// conditional link, so concurrent first checkouts converge on one plan id
// (a losing request's extra provider plan has no subscriptions and costs
// nothing). The database trigger forbids re-pointing a linked version. The
// catalogue is read-only to the runtime roles; the link goes through the one
// definer function that may set an unset provider plan (platform migration 070).
export async function ensureProviderPlan(client, provider, price, env = process.env) {
  if (price.provider_plan_id) return price.provider_plan_id;
  const created = await provider.createPlan(buildProviderPlanPayload(price, env));
  return (await client.query(`SELECT public.link_billing_price_provider_plan($1, $2) AS provider_plan_id`, [price.price_id, created.id])).rows[0].provider_plan_id;
}
