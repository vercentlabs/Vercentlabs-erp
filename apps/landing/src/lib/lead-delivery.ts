import { createHmac, randomUUID } from "node:crypto";

import type { LeadKind, LeadPayload } from "@/lib/lead-validation";

type DeliveryResult =
  { success: true } | { success: false; status: number; message: string };

type DeliveryContext = {
  fingerprint: string;
  origin: string;
};

function splitName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts.shift() || name,
    lastName: parts.length ? parts.join(" ") : null,
  };
}

function timeoutMilliseconds() {
  const configured = Number(process.env.WEBHOOK_TIMEOUT_MS || "8000");
  return Number.isFinite(configured)
    ? Math.min(Math.max(configured, 1000), 15000)
    : 8000;
}

function demoValue(current: string | undefined, legacy: string | undefined) {
  return current?.trim() || legacy?.trim() || "";
}

async function deliverToCrmCapture(
  kind: LeadKind,
  data: LeadPayload,
  context: DeliveryContext,
): Promise<DeliveryResult | null> {
  const captureUrl =
    (kind === "demo"
      ? demoValue(
          process.env.DEMO_CRM_CAPTURE_URL,
          process.env.SIGNUP_CRM_CAPTURE_URL,
        )
      : "") || process.env.CRM_CAPTURE_URL?.trim();
  if (!captureUrl) return null;

  const proxySecret = process.env.CRM_CAPTURE_PROXY_SECRET?.trim();
  if (!proxySecret || proxySecret.length < 32) {
    return {
      success: false,
      status: 503,
      message:
        "Secure CRM delivery is not configured. Please use the email option below.",
    };
  }

  const name = splitName(data.name);
  const payload = JSON.stringify({
    ...name,
    email: data.email,
    phone: data.phone || null,
    companyName: data.company,
    productInterest: data.interest || null,
    consentEmail: data.consent,
    websiteUrl: "",
    companyWebsiteHidden: "",
    customData: {
      source: "vercentlabs-landing",
      requestKind: kind,
      teamSize: data.teamSize || null,
      message: data.message || null,
      submittedAt: new Date().toISOString(),
    },
  });
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", proxySecret)
    .update(`${timestamp}.${context.fingerprint}.${payload}`)
    .digest("hex");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMilliseconds());

  try {
    const response = await fetch(captureUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: context.origin,
        "X-Vercent-Capture-Timestamp": timestamp,
        "X-Vercent-Capture-Fingerprint": context.fingerprint,
        "X-Vercent-Capture-Signature": signature,
      },
      body: payload,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        success: false,
        status: response.status === 429 ? 429 : 502,
        message:
          response.status === 429
            ? "Too many requests. Try again later."
            : "The CRM could not accept the request. Please use the email option below.",
      };
    }
    return { success: true };
  } catch {
    return {
      success: false,
      status: 502,
      message:
        "The CRM is temporarily unavailable. Please use the email option below.",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function deliverToGenericWebhook(
  kind: LeadKind,
  data: LeadPayload,
): Promise<DeliveryResult> {
  const webhookUrl =
    (kind === "demo"
      ? demoValue(process.env.DEMO_WEBHOOK_URL, process.env.SIGNUP_WEBHOOK_URL)
      : "") || process.env.LEAD_WEBHOOK_URL?.trim();
  const webhookSecret =
    (kind === "demo"
      ? demoValue(
          process.env.DEMO_WEBHOOK_SECRET,
          process.env.SIGNUP_WEBHOOK_SECRET,
        )
      : "") || process.env.LEAD_WEBHOOK_SECRET?.trim();

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
    event: kind === "demo" ? "demo.requested" : "contact.enquiry",
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
    ? `sha256=${createHmac("sha256", webhookSecret).update(payload).digest("hex")}`
    : "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMilliseconds());

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

export async function deliverLead(
  kind: LeadKind,
  data: LeadPayload,
  context: DeliveryContext,
): Promise<DeliveryResult> {
  return (
    (await deliverToCrmCapture(kind, data, context)) ||
    deliverToGenericWebhook(kind, data)
  );
}
