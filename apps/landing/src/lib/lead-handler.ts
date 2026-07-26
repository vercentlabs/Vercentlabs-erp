import { NextResponse } from "next/server";

import { deliverLead } from "@/lib/lead-delivery";
import { siteConfig } from "@/lib/site-config";
import {
  enforceLeadRateLimit,
  hasAllowedOrigin,
  leadFingerprint,
  readJsonBody,
} from "@/lib/lead-security";
import { type LeadKind, validateLeadPayload } from "@/lib/lead-validation";

function json(
  body: Record<string, unknown>,
  status: number,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export async function handleLeadRequest(request: Request, kind: LeadKind) {
  if (!hasAllowedOrigin(request)) {
    return json(
      { ok: false, message: "This request origin is not allowed." },
      403,
    );
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return json(
      { ok: false, message: "Content-Type must be application/json." },
      415,
    );
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return json({ ok: false, message: parsed.message }, parsed.status);
  }

  const result = validateLeadPayload(parsed.data, kind);
  if (!result.success) {
    return json(
      {
        ok: false,
        message:
          result.errors.form ||
          Object.values(result.errors)[0] ||
          "Review the form fields.",
        errors: result.errors,
      },
      400,
    );
  }

  if (result.data.website) {
    return json({ ok: true, message: "Your request has been received." }, 202);
  }

  if (Date.now() - result.data.startedAt < 800) {
    return json(
      { ok: false, message: "Please review the form and try again." },
      400,
    );
  }

  const rateLimit = await enforceLeadRateLimit(request, kind);
  const retryAfter = Math.max(
    1,
    Math.ceil((rateLimit.resetAt - Date.now()) / 1000),
  );
  const rateHeaders = {
    "X-RateLimit-Limit": String(rateLimit.limit),
    "X-RateLimit-Remaining": String(rateLimit.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rateLimit.resetAt / 1000)),
    ...(rateLimit.allowed ? {} : { "Retry-After": String(retryAfter) }),
  };

  if (!rateLimit.allowed) {
    return json(
      {
        ok: false,
        message:
          rateLimit.message || "The request cannot be accepted right now.",
        fallbackEmail: siteConfig.email,
      },
      rateLimit.status,
      rateHeaders,
    );
  }

  const fingerprint = leadFingerprint(request);
  if (!fingerprint) {
    return json(
      {
        ok: false,
        message: "Secure form delivery is not configured.",
        fallbackEmail: siteConfig.email,
      },
      503,
      rateHeaders,
    );
  }

  const configuredSiteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || siteConfig.siteUrl;
  const origin = new URL(configuredSiteUrl).origin;
  const delivery = await deliverLead(kind, result.data, {
    fingerprint,
    origin,
  });
  if (!delivery.success) {
    return json(
      {
        ok: false,
        message: delivery.message,
        fallbackEmail: siteConfig.email,
      },
      delivery.status,
      rateHeaders,
    );
  }

  return json(
    {
      ok: true,
      message:
        kind === "demo"
          ? "Your demo request has been delivered to Vercentlabs."
          : "Your enquiry has been delivered to Vercentlabs.",
    },
    202,
    rateHeaders,
  );
}
