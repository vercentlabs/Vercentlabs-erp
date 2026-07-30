import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { HttpError } from "@/lib/http";

const API_BASE = "https://api.razorpay.com/v1";

export function razorpayConfiguration() {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim() || "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim() || "";
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || "";
  const previousWebhookSecret =
    process.env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS?.trim() || "";
  const mode = process.env.RAZORPAY_MODE === "live" ? "live" : "test";
  const detectedMode = keyId.startsWith("rzp_live_")
    ? "live"
    : keyId.startsWith("rzp_test_")
      ? "test"
      : null;
  const checkoutFlag =
    process.env.BILLING_CHECKOUT_ENABLED?.trim().toLowerCase() || "";
  return {
    keyId,
    keySecret,
    webhookSecret,
    previousWebhookSecret,
    configured: Boolean(keyId && keySecret),
    webhookConfigured: Boolean(webhookSecret),
    mode,
    detectedMode,
    modeMatches: !detectedMode || detectedMode === mode,
    checkoutEnabled:
      checkoutFlag === "true" ||
      (checkoutFlag === "" && process.env.NODE_ENV !== "production"),
  } as const;
}

export async function razorpayRequest<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const config = razorpayConfiguration();
  if (!config.configured) {
    throw new HttpError(
      503,
      "Razorpay is not configured. Add the test keys to the ignored apps/web/.env.local file.",
    );
  }
  if (!config.modeMatches) {
    throw new HttpError(
      503,
      `RAZORPAY_MODE=${config.mode} does not match the configured ${config.detectedMode} key.`,
    );
  }
  const timeoutRaw = Number(process.env.RAZORPAY_REQUEST_TIMEOUT_MS || 15_000);
  if (!Number.isInteger(timeoutRaw) || timeoutRaw < 1_000 || timeoutRaw > 120_000) {
    throw new HttpError(
      500,
      "RAZORPAY_REQUEST_TIMEOUT_MS must be an integer between 1000 and 120000.",
    );
  }
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutRaw),
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: { description?: string; reason?: string };
  };
  if (!response.ok) {
    throw new HttpError(
      502,
      payload.error?.description ||
        payload.error?.reason ||
        "Razorpay rejected the billing request.",
    );
  }
  return payload;
}

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function verifyRazorpayPaymentSignature(input: {
  paymentId: string;
  subscriptionId: string;
  signature: string;
}) {
  const { keySecret } = razorpayConfiguration();
  if (!keySecret)
    throw new HttpError(
      503,
      "Razorpay payment verification is not configured.",
    );
  const expected = createHmac("sha256", keySecret)
    .update(`${input.paymentId}|${input.subscriptionId}`)
    .digest("hex");
  if (!secureEqual(expected, input.signature)) {
    throw new HttpError(400, "Razorpay payment verification failed.");
  }
}

export function verifyRazorpayWebhookSignature(
  rawBody: string,
  signature: string,
) {
  const { webhookSecret, previousWebhookSecret } = razorpayConfiguration();
  if (!webhookSecret) {
    throw new HttpError(
      503,
      "Razorpay webhook verification is not configured.",
    );
  }
  const candidates = [webhookSecret, previousWebhookSecret].filter(Boolean);
  const valid = candidates.some((secret) => {
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    return secureEqual(expected, signature);
  });
  if (!valid) {
    throw new HttpError(400, "Razorpay webhook signature is invalid.");
  }
}
