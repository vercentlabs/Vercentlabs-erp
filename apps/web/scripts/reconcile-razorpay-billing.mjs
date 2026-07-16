import path from "node:path";

import dotenv from "dotenv";
import pg from "pg";

import { mapProviderSubscriptionStatus } from "@vercent/api";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });
const keyId = process.env.RAZORPAY_KEY_ID?.trim();
const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
if (!keyId || !keySecret) {
  console.log("Razorpay reconciliation skipped: API keys are not configured.");
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

try {
  const subscriptions = await pool.query(`
    SELECT id, provider_subscription_id
    FROM organization_subscriptions
    WHERE provider = 'razorpay' AND provider_subscription_id IS NOT NULL
  `);
  let reconciled = 0;
  for (const local of subscriptions.rows) {
    const response = await fetch(
      `https://api.razorpay.com/v1/subscriptions/${encodeURIComponent(local.provider_subscription_id)}`,
      { headers: { Authorization: auth }, cache: "no-store" },
    );
    const provider = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.warn(
        `Could not reconcile ${local.provider_subscription_id}: ${provider?.error?.description || response.status}`,
      );
      continue;
    }
    await pool.query(
      `
        UPDATE organization_subscriptions SET
          status = $2,
          provider_status = $3,
          current_period_started_at = CASE WHEN $4::bigint > 0 THEN to_timestamp($4) ELSE current_period_started_at END,
          current_period_ends_at = CASE WHEN $5::bigint > 0 THEN to_timestamp($5) ELSE current_period_ends_at END,
          grace_ends_at = CASE
            WHEN $2 IN ('past_due', 'halted') THEN
              CASE
                WHEN $5::bigint > 0 THEN to_timestamp($5) + interval '7 days'
                ELSE now() + interval '7 days'
              END
            WHEN $2 IN ('active', 'authenticated') THEN NULL
            ELSE grace_ends_at
          END,
          cancelled_at = CASE WHEN $6::bigint > 0 THEN to_timestamp($6) ELSE cancelled_at END,
          last_provider_event_at = now()
        WHERE id = $1
      `,
      [
        local.id,
        mapProviderSubscriptionStatus(provider.status),
        provider.status,
        Number(provider.current_start || 0),
        Number(provider.current_end || 0),
        Number(provider.ended_at || 0),
      ],
    );
    reconciled += 1;
  }
  console.log(
    `Razorpay billing reconciliation completed. Subscriptions reconciled: ${reconciled}.`,
  );
} finally {
  await pool.end();
}
