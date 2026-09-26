import { Agent, request as undiciRequest } from "undici";

import { resolveSafeAddress, validateWebhookUrl, SsrfError } from "./ssrf.js";
import { boundedRetryAfterMilliseconds } from "./backoff.js";

const MAX_RESPONSE_BYTES = 64 * 1024; // bounded read — Part 18/70: a huge response must never consume excessive worker memory
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

export class WebhookDeliveryError extends Error {
  constructor(message, { retryable, code = "WEBHOOK_DELIVERY_ERROR" } = {}) {
    super(message);
    this.retryable = Boolean(retryable);
    this.code = code;
  }
}

async function readBoundedBody(bodyStream) {
  const chunks = [];
  let total = 0;
  for await (const chunk of bodyStream) {
    total += chunk.length;
    if (total > MAX_RESPONSE_BYTES) {
      chunks.push(chunk.subarray(0, MAX_RESPONSE_BYTES - (total - chunk.length)));
      break;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// Classifies an HTTP response into success / retryable / terminal, per
// this prompt's own policy: 2xx succeeds; 408/425/429/5xx/network-
// failure/timeout retries; everything else (most 4xx, a malformed URL, a
// forbidden destination) is terminal — a 400 does not retry forever.
function classifyStatus(statusCode) {
  if (statusCode >= 200 && statusCode < 300) return "success";
  if (RETRYABLE_STATUS_CODES.has(statusCode)) return "retryable";
  return "terminal";
}

// Delivers one webhook POST. Never follows redirects (maxRedirections: 0)
// — a redirect target is a different, unvalidated destination, and
// silently following it would reopen the exact SSRF hole the lookup-
// pinning below closes. Every DNS resolution used for the actual TCP
// connection goes through resolveSafeAddress() (Part 29's real,
// non-time-gapped protection), not merely the pre-flight
// validateWebhookUrl() structural check.
// `body` is the exact serialized request body (what the signature covers);
// `headers` carries the event/delivery/timestamp/signature headers.
export async function deliverWebhook(endpointUrl, { body, payload, headers = {}, timeoutMilliseconds, allowPrivateTargets = false, deliveryId }) {
  const startedAt = Date.now();
  let agent;
  try {
    const parsed = validateWebhookUrl(endpointUrl, { allowPrivate: allowPrivateTargets });

    agent = new Agent({
      connect: {
        lookup: (hostname, options, callback) => {
          resolveSafeAddress(hostname, { allowPrivate: allowPrivateTargets })
            .then((safe) => callback(null, [{ address: safe.address, family: safe.family }]))
            .catch((error) => callback(error));
        },
      },
    });

    const response = await undiciRequest(parsed, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
        "user-agent": "Vercentlabs-Webhooks/1.0",
        "x-vercentlabs-delivery-id": deliveryId || "",
      },
      body: typeof body === "string" ? body : JSON.stringify(payload ?? {}),
      dispatcher: agent,
      maxRedirections: 0,
      bodyTimeout: timeoutMilliseconds,
      headersTimeout: timeoutMilliseconds,
    });
    const bodyText = await readBoundedBody(response.body);
    const outcome = classifyStatus(response.statusCode);
    const retryAfterHeader = response.headers["retry-after"];
    const retryAfterMilliseconds = retryAfterHeader
      ? boundedRetryAfterMilliseconds(Number(retryAfterHeader))
      : null;
    return {
      outcome,
      statusCode: response.statusCode,
      durationMilliseconds: Date.now() - startedAt,
      bodyPreview: bodyText.slice(0, 2_000),
      retryAfterMilliseconds,
    };
  } catch (error) {
    if (error instanceof SsrfError) {
      // A forbidden/unresolvable destination is a policy violation, not a
      // transient network condition — terminal, never retried.
      throw new WebhookDeliveryError(error.message, { retryable: false, code: "SSRF_BLOCKED" });
    }
    const isTimeout = error?.code === "UND_ERR_HEADERS_TIMEOUT" || error?.code === "UND_ERR_BODY_TIMEOUT" || error?.name === "TimeoutError";
    // Any other network-level failure (connection refused, reset, DNS
    // failure surfaced by undici itself) is treated as retryable — the
    // endpoint may simply be transiently unreachable.
    throw new WebhookDeliveryError(
      isTimeout ? "The webhook endpoint did not respond in time." : `Webhook delivery failed: ${error?.message || error}`,
      { retryable: true, code: isTimeout ? "WEBHOOK_TIMEOUT" : "WEBHOOK_NETWORK_ERROR" },
    );
  } finally {
    if (agent) await agent.close();
  }
}
