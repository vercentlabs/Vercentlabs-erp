import { NextResponse } from "next/server";

import { deliverLead } from "@/lib/lead-delivery";
import { siteConfig } from "@/lib/site-config";
import {
  enforceLeadRateLimit,
  hasAllowedOrigin,
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
  const rateHeaders = {
    "X-RateLimit-Limit": String(rateLimit.limit),
    "X-RateLimit-Remaining": String(rateLimit.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rateLimit.resetAt / 1000)),
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

  const delivery = await deliverLead(kind, result.data);
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
        kind === "signup"
          ? "Your design-partner application has been delivered."
          : "Your enquiry has been delivered to VercentLabs.",
    },
    202,
    rateHeaders,
  );
}
