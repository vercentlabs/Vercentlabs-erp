import path from "node:path";

import dotenv from "dotenv";
import pg from "pg";

import { assertPlanEconomics, buildRazorpayPlanPayload } from "@vercent/api";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });

const keyId = process.env.RAZORPAY_KEY_ID?.trim();
const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
if (!keyId || !keySecret) {
  console.log(
    "Razorpay plan sync skipped: add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to apps/web/.env.local.",
  );
  process.exit(0);
}
const configuredMode = process.env.RAZORPAY_MODE === "live" ? "live" : "test";
const detectedMode = keyId?.startsWith("rzp_live_")
  ? "live"
  : keyId?.startsWith("rzp_test_")
    ? "test"
    : null;
if (detectedMode && detectedMode !== configuredMode) {
  throw new Error(
    `RAZORPAY_MODE=${configuredMode} does not match the configured ${detectedMode} key.`,
  );
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;

async function createProviderPlan(body) {
  const response = await fetch("https://api.razorpay.com/v1/plans", {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      payload?.error?.description || "Razorpay plan creation failed.",
    );
  }
  return payload;
}

try {
  const result = await pool.query(`
    SELECT price.id, price.billing_period, price.amount_paise, price.currency,
      price.version, price.provider_plan_id, plan.code AS plan_code,
      plan.name, plan.description, plan.cost_model
    FROM billing_plan_prices price
    JOIN billing_plans plan ON plan.id = price.plan_id
    WHERE price.active AND plan.status = 'active' AND plan.is_public
      AND price.billing_period IN ('monthly', 'yearly')
    ORDER BY plan.display_order, price.billing_period
  `);

  let created = 0;
  for (const row of result.rows) {
    const monthlyEquivalent =
      row.billing_period === "yearly"
        ? Math.floor(Number(row.amount_paise) / 12)
        : Number(row.amount_paise);
    assertPlanEconomics({
      amountPaise: monthlyEquivalent,
      estimatedDirectCostPaise: Number(
        row.cost_model?.estimated_direct_cost_paise || 0,
      ),
      gatewayReservePercent: Number(
        process.env.BILLING_PAYMENT_COST_RESERVE_PERCENT ||
          row.cost_model?.gateway_reserve_percent ||
          4,
      ),
      minimumMarginPercent: Number(
        process.env.BILLING_MIN_GROSS_MARGIN_PERCENT ||
          row.cost_model?.minimum_margin_percent ||
          70,
      ),
    });

    if (row.provider_plan_id) {
      console.log(
        `Skipped ${row.plan_code}/${row.billing_period}: ${row.provider_plan_id}`,
      );
      continue;
    }

    const provider = await createProviderPlan(
      buildRazorpayPlanPayload({
        id: row.id,
        planCode: row.plan_code,
        name: `Vercent ERP ${row.name}`,
        description: row.description,
        billingPeriod: row.billing_period,
        amountPaise: Number(row.amount_paise),
        currency: row.currency,
        version: row.version,
      }),
    );
    await pool.query(
      `UPDATE billing_plan_prices SET provider_plan_id = $2 WHERE id = $1 AND provider_plan_id IS NULL`,
      [row.id, provider.id],
    );
    created += 1;
    console.log(
      `Created ${row.plan_code}/${row.billing_period}: ${provider.id}`,
    );
  }
  console.log(`Razorpay plan sync completed. New provider plans: ${created}.`);
} finally {
  await pool.end();
}
