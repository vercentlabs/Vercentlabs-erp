import path from "node:path";

import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const endpoint =
  process.env.BILLING_WEBHOOK_REPLAY_URL?.trim() ||
  `${(process.env.APP_URL || "http://127.0.0.1:3001").replace(/\/$/, "")}/api/billing/webhooks/razorpay`;
const batchSize = Number(process.env.RAZORPAY_WEBHOOK_RETRY_BATCH_SIZE || 25);
const timeoutMs = Number(process.env.RAZORPAY_REQUEST_TIMEOUT_MS || 15_000);
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 250) {
  throw new Error("RAZORPAY_WEBHOOK_RETRY_BATCH_SIZE must be between 1 and 250.");
}
if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
  throw new Error("RAZORPAY_REQUEST_TIMEOUT_MS must be between 1000 and 120000.");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const events = await pool.query(
    `
      SELECT id, provider_event_id, payload, signature_value
      FROM billing_webhook_events
      WHERE provider = 'razorpay'
        AND processing_status = 'failed'
        AND next_attempt_at <= now()
        AND signature_value IS NOT NULL
      ORDER BY next_attempt_at, created_at
      LIMIT $1
    `,
    [batchSize],
  );

  let replayed = 0;
  let failed = 0;
  for (const event of events.rows) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-razorpay-event-id": event.provider_event_id,
          "x-razorpay-signature": event.signature_value,
          "x-vercentlabs-replay": "billing-webhook-worker",
        },
        body: JSON.stringify(event.payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        failed += 1;
        console.warn(
          `Webhook replay ${event.provider_event_id} returned ${response.status}.`,
        );
        continue;
      }
      replayed += 1;
    } catch (error) {
      failed += 1;
      console.warn(
        `Webhook replay ${event.provider_event_id} failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  const deadLetters = await pool.query(
    `SELECT count(*)::int AS count
       FROM billing_webhook_events
      WHERE provider = 'razorpay' AND processing_status = 'dead_lettered'`,
  );

  console.log(
    JSON.stringify({
      selected: events.rowCount,
      replayed,
      failed,
      deadLetters: deadLetters.rows[0]?.count || 0,
    }),
  );
  if ((deadLetters.rows[0]?.count || 0) > 0) process.exitCode = 2;
} finally {
  await pool.end();
}
