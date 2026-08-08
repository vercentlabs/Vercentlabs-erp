import { NextResponse } from "next/server";
import { validateDemoForm, type DemoFormValues } from "@/lib/demo-form-validation";
import { deliverDemoRequest } from "@/lib/crm-capture";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIp, generateRequestId } from "@/lib/request";
import { logLeadCaptureEvent, isTimeoutError } from "@/lib/lead-observability";

export const runtime = "nodejs";

interface RequestBody extends DemoFormValues {
  attribution?: {
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    utmTerm?: string;
    landingPath?: string;
    referrerCategory?: string;
  };
  modulesOfInterest?: string[];
}

export async function POST(request: Request) {
  const requestId = generateRequestId();
  const ip = clientIp(request);
  const startedAt = Date.now();

  const rateLimit = checkRateLimit(`book-demo:${ip}`, 5, 15 * 60 * 1000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { ok: false, requestId, error: "Too many requests. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)) } },
    );
  }

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, requestId, error: "Invalid request." }, { status: 400 });
  }
  // `JSON.parse("null")` (and "5", "\"x\"", etc.) succeeds — a syntactically
  // valid body that isn't an object still reaches here. Property access
  // inside validateDemoForm() (e.g. `values.firstName`) throws on null/undefined,
  // which previously crashed into an uncaught, unlogged 500 with an empty body.
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, requestId, error: "Invalid request." }, { status: 400 });
  }

  const errors = validateDemoForm(body);
  if (Object.keys(errors).length > 0) {
    logLeadCaptureEvent("validation_failure", requestId, Date.now() - startedAt, 422);
    return NextResponse.json({ ok: false, requestId, errors }, { status: 422 });
  }

  try {
    const result = await deliverDemoRequest(
      {
        firstName: body.firstName.trim(),
        lastName: body.lastName?.trim() || undefined,
        email: body.email.trim(),
        phone: body.phone.trim(),
        companyName: body.companyName?.trim() || undefined,
        jobTitle: body.jobTitle?.trim() || undefined,
        industry: body.industry?.trim() || undefined,
        productInterest: body.primaryInterest?.trim() || undefined,
        consentEmail: Boolean(body.consentEmail),
        websiteUrl: body.websiteUrl || "",
        companyWebsiteHidden: body.companyWebsiteHidden || "",
        customData: {
          companySize: body.companySize?.trim() || undefined,
          modulesOfInterest: body.modulesOfInterest?.length ? body.modulesOfInterest : undefined,
          mainChallenge: body.mainChallenge?.trim() || undefined,
          preferredContactTime: body.preferredContactTime?.trim() || undefined,
          // Client-supplied attribution spreads FIRST so the server-trusted
          // requestId/source below always win — previously spread last, which
          // let an attacker-controlled `attribution.requestId`/`.source` value
          // silently overwrite the server's own trusted lead-source fields.
          ...(body.attribution ?? {}),
          requestId,
          source: "landing-book-demo",
        },
      },
      ip,
      request.headers.get("user-agent") || "unknown",
    );

    if (!result.ok) {
      // Safe server-side log: request id and status only, never the submitted
      // name/email/phone (see conversion-architecture.md's PII-redaction rule).
      logLeadCaptureEvent("upstream_failure", requestId, Date.now() - startedAt, result.status);
      return NextResponse.json(
        { ok: false, requestId, error: "We couldn't submit your request. Please try again." },
        { status: 502 },
      );
    }

    logLeadCaptureEvent("success", requestId, Date.now() - startedAt, 201);
    return NextResponse.json({ ok: true, requestId }, { status: 201 });
  } catch (error) {
    const outcome = isTimeoutError(error) ? "timeout" : "upstream_failure";
    logLeadCaptureEvent(outcome, requestId, Date.now() - startedAt);
    return NextResponse.json(
      { ok: false, requestId, error: "We couldn't submit your request. Please try again." },
      { status: 500 },
    );
  }
}
