// Commercial catalogue and pricing.
//
//   Free      1 included user, ₹0, no payment details.
//   Standard  first user included; ₹1,000 (100000 paise) per additional user per month, INR.
//             Razorpay quantity = number of additional (paid) users.
//   Custom    plan code `enterprise` (historical); contracted, never bought online.
//
// Commercial terms live on immutable price VERSIONS (billing_plan_prices;
// migration 061 enforces immutability in the database). New checkout always
// uses the single active version; historical subscriptions keep theirs.
import { BillingServiceError } from "./errors.js";

export const COMMERCIAL_MODEL = Object.freeze({
  currency: "INR",
  free: Object.freeze({ code: "free", includedUsers: 1, pricePaise: 0 }),
  standard: Object.freeze({ code: "standard", includedUsers: 1, perAdditionalUserPaise: 100000, billingPeriod: "monthly" }),
  custom: Object.freeze({ code: "enterprise" }),
});

export const MAX_SEATED_USERS = 500;

// Pure pricing: integer paise only. The server computes every authoritative amount.
export function calculateSeatCharge({ includedUsers, perUserPaise, totalUsers }) {
  const included = Number(includedUsers);
  const total = Number(totalUsers);
  const perUser = Number(perUserPaise);
  if (!Number.isInteger(total) || total < 1) throw new BillingServiceError(422, "Enter a whole number of users.", "BILLING_USERS_INVALID");
  if (!Number.isInteger(included) || included < 0 || !Number.isSafeInteger(perUser) || perUser < 0) {
    throw new BillingServiceError(500, "The price version is not valid.", "BILLING_PRICE_INVALID");
  }
  const billableSeats = Math.max(0, total - included);
  return { totalUsers: total, includedUsers: included, billableSeats, monthlyPaise: billableSeats * perUser };
}

// The single active price version for a plan (monthly, or custom for Custom).
export async function currentPrice(client, planCode) {
  const rows = await client.query(
    `SELECT price.id AS price_id, price.amount_paise, price.currency, price.billing_period, price.version, price.provider_plan_id,
            price.included_users, plan.code, plan.name, plan.availability, plan.pricing_model, plan.status, plan.modules, plan.limits
       FROM billing_plan_prices price JOIN billing_plans plan ON plan.id = price.plan_id
      WHERE plan.code = $1 AND price.active AND plan.status = 'active'
      ORDER BY price.version DESC LIMIT 1`,
    [planCode],
  );
  return rows.rows[0] || null;
}

export function salesContact(env = process.env) {
  const url = String(env.BILLING_SALES_CONTACT_URL || "").trim();
  return /^(https:\/\/|mailto:)[^\s"<>]+$/i.test(url) ? url : null;
}

export async function listPlanCatalogue(client, organizationId = null, env = process.env) {
  const rows = await client.query(
    `SELECT price.id AS price_id, price.amount_paise, price.currency, price.billing_period, price.included_users AS price_included_users,
            plan.code, plan.name, plan.description, plan.features, plan.availability, plan.pricing_model, plan.included_users
       FROM billing_plans plan
       JOIN billing_plan_prices price ON price.plan_id = plan.id AND price.active AND price.billing_period IN ('monthly', 'custom')
      WHERE plan.status = 'active' AND plan.is_public
      ORDER BY plan.display_order`,
  );
  const current = organizationId
    ? (await client.query(
        `SELECT plan.code FROM organization_subscriptions s JOIN billing_plan_prices price ON price.id = s.plan_price_id
           JOIN billing_plans plan ON plan.id = price.plan_id WHERE s.organization_id = $1`,
        [organizationId],
      )).rows[0]
    : null;
  const checkoutEnabled = String(env.BILLING_CHECKOUT_ENABLED || "").toLowerCase() === "true";
  return rows.rows.map((row) => ({
    priceId: row.price_id,
    code: row.code,
    name: row.name,
    description: row.description,
    features: Array.isArray(row.features) ? row.features : [],
    availability: row.availability,
    pricingModel: row.pricing_model,
    includedUsers: row.price_included_users ?? row.included_users,
    perUserPricePaise: row.pricing_model === "per_seat" ? Number(row.amount_paise) : null,
    currency: row.currency,
    current: current?.code === row.code,
    purchasable: row.availability === "available" && row.pricing_model === "per_seat" && checkoutEnabled,
    contactSales: row.availability === "contact_sales",
    salesContactUrl: row.availability === "contact_sales" ? salesContact(env) : null,
  }));
}

export function buildProviderPlanPayload(price) {
  if (!Number.isSafeInteger(Number(price.amount_paise)) || Number(price.amount_paise) <= 0) {
    throw new BillingServiceError(500, "A positive recurring price is required.", "BILLING_PRICE_INVALID");
  }
  if (price.billing_period !== "monthly") throw new BillingServiceError(500, "Only monthly prices are sold online.", "BILLING_PRICE_INVALID");
  return {
    period: "monthly",
    interval: 1,
    item: {
      name: `${price.name} - per additional user (v${price.version})`,
      description: `${price.name}: one additional user, billed monthly`,
      amount: Number(price.amount_paise),
      currency: price.currency || "INR",
    },
    notes: { vercentlabs_plan_code: price.code, vercentlabs_price_id: price.price_id, vercentlabs_price_version: String(price.version) },
  };
}

// Each price version gets exactly one provider plan, linked permanently.
// Plan creation is an HTTP call made OUTSIDE any transaction; the link is a
// conditional update, so concurrent first checkouts converge on one plan id
// (a losing request's extra provider plan has no subscriptions and costs
// nothing). The database trigger forbids re-pointing a linked version.
export async function ensureProviderPlan(client, provider, price) {
  if (price.provider_plan_id) return price.provider_plan_id;
  const created = await provider.createPlan(buildProviderPlanPayload(price));
  await client.query(`UPDATE billing_plan_prices SET provider_plan_id = $2 WHERE id = $1 AND provider_plan_id IS NULL`, [price.price_id, created.id]);
  return (await client.query(`SELECT provider_plan_id FROM billing_plan_prices WHERE id = $1`, [price.price_id])).rows[0].provider_plan_id;
}
