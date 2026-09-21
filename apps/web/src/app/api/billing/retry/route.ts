import { timingSafeEqual } from "node:crypto";

import { retryBillingWebhooks } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { errorResponse, fail, ok } from "@/core/http";

// Called by a scheduler (cron, a platform scheduled job) to re-run webhook events that failed. There is no user
// session: the shared secret in x-billing-cron-secret is the credential.
export async function POST(request: Request) {
  try {
    const secret = process.env.BILLING_CRON_SECRET || "";
    const given = request.headers.get("x-billing-cron-secret") || "";
    const a = Buffer.from(secret);
    const b = Buffer.from(given);
    if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return fail("Not authorised.", 401, { code: "BILLING_CRON_UNAUTHORISED" });
    return ok(await withClient((client) => retryBillingWebhooks(client, { limit: 50 })));
  } catch (error) {
    return errorResponse(error);
  }
}
