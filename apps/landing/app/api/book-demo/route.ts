import { NextResponse } from "next/server";
import { validateDemoForm, type DemoFormValues } from "@/lib/demo-form-validation";
import { deliverDemoRequest } from "@/lib/crm-capture";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIp, generateRequestId } from "@/lib/request";

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

  const errors = validateDemoForm(body);
  if (Object.keys(errors).length > 0) {
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
          requestId,
          source: "landing-book-demo",
          ...(body.attribution ?? {}),
        },
      },
      ip,
      request.headers.get("user-agent") || "unknown",
    );

    if (!result.ok) {
      // Safe server-side log: request id and status only, never the submitted
      // name/email/phone (see conversion-architecture.md's PII-redaction rule).
      console.error(`[book-demo] delivery failed requestId=${requestId} status=${result.status}`);
      return NextResponse.json(
        { ok: false, requestId, error: "We couldn't submit your request. Please try again." },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, requestId }, { status: 201 });
  } catch (error) {
    console.error(`[book-demo] delivery error requestId=${requestId}`, error instanceof Error ? error.message : error);
    return NextResponse.json(
      { ok: false, requestId, error: "We couldn't submit your request. Please try again." },
      { status: 500 },
    );
  }
}
