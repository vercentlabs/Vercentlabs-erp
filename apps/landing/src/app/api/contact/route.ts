import { NextResponse } from "next/server";

import { landingConfig } from "@/lib/landing-config";
import { validateLeadPayload } from "@/lib/lead-validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || "0");

  if (contentLength > 50000) {
    return NextResponse.json(
      {
        ok: false,
        message: "The request is too large.",
      },
      {
        status: 413,
      },
    );
  }

  let input: unknown;

  try {
    input = await request.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "Invalid JSON request.",
      },
      {
        status: 400,
      },
    );
  }

  const result = validateLeadPayload(input, "contact");

  if (!result.success) {
    return NextResponse.json(
      {
        ok: false,
        message:
          result.errors.form ||
          Object.values(result.errors)[0] ||
          "Review the form fields.",
        errors: result.errors,
      },
      {
        status: 400,
      },
    );
  }

  if (result.data.website) {
    return NextResponse.json({
      ok: true,
      message: "Your request has been received.",
    });
  }

  const webhookUrl = process.env.LEAD_WEBHOOK_URL?.trim();

  if (!webhookUrl) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Online enquiry delivery is not configured yet. Please use the email option below.",
        fallbackEmail: landingConfig.contactEmail,
      },
      {
        status: 503,
      },
    );
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.LEAD_WEBHOOK_SECRET
          ? {
              Authorization: "Bearer " + process.env.LEAD_WEBHOOK_SECRET,
            }
          : {}),
      },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        source: "vercentlabs-landing",
        submittedAt: new Date().toISOString(),
        ...result.data,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "The enquiry service could not accept the request. Please use the email option below.",
          fallbackEmail: landingConfig.contactEmail,
        },
        {
          status: 502,
        },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        message: "Your enquiry has been delivered to VercentLabs.",
      },
      {
        status: 202,
      },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message:
          "The enquiry service is temporarily unavailable. Please use the email option below.",
        fallbackEmail: landingConfig.contactEmail,
      },
      {
        status: 502,
      },
    );
  }
}
