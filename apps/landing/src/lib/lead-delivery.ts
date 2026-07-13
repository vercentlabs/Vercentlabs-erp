import { createHmac, randomUUID } from "node:crypto";

import type { LeadKind, LeadPayload } from "@/lib/lead-validation";

type DeliveryResult =
  { success: true } | { success: false; status: number; message: string };

export async function deliverLead(
  kind: LeadKind,
  data: LeadPayload,
): Promise<DeliveryResult> {
  const webhookUrl =
    (kind === "signup" ? process.env.SIGNUP_WEBHOOK_URL?.trim() : "") ||
    process.env.LEAD_WEBHOOK_URL?.trim();

  const webhookSecret =
    (kind === "signup" ? process.env.SIGNUP_WEBHOOK_SECRET : "") ||
    process.env.LEAD_WEBHOOK_SECRET;

  if (!webhookUrl) {
    return {
      success: false,
      status: 503,
      message:
        "Online delivery is not configured yet. Please use the email option below.",
    };
  }

  if (process.env.NODE_ENV === "production" && !webhookSecret) {
    return {
      success: false,
      status: 503,
      message:
        "Secure form delivery is not configured. Please use the email option below.",
    };
  }

  const payload = JSON.stringify({
    id: randomUUID(),
    event: kind === "signup" ? "design_partner.application" : "contact.enquiry",
    source: "vercentlabs-landing",
    submittedAt: new Date().toISOString(),
    lead: {
      name: data.name,
      email: data.email,
      company: data.company,
      phone: data.phone,
      interest: data.interest,
      teamSize: data.teamSize,
      message: data.message,
      consent: data.consent,
    },
  });

  const signature = webhookSecret
    ? "sha256=" +
      createHmac("sha256", webhookSecret).update(payload).digest("hex")
    : "";

  const configuredTimeout = Number(process.env.WEBHOOK_TIMEOUT_MS || "8000");
  const timeoutMs = Number.isFinite(configuredTimeout)
    ? Math.min(Math.max(configuredTimeout, 1000), 15000)
    : 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Vercent-Event": kind,
        ...(signature ? { "X-Vercent-Signature": signature } : {}),
      },
      body: payload,
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        success: false,
        status: 502,
        message:
          "The enquiry service could not accept the request. Please use the email option below.",
      };
    }

    return { success: true };
  } catch {
    return {
      success: false,
      status: 502,
      message:
        "The enquiry service is temporarily unavailable. Please use the email option below.",
    };
  } finally {
    clearTimeout(timer);
  }
}
