import { createHash, createHmac } from "node:crypto";
import { APP_URL } from "./site.ts";

/**
 * Server-only. Signs and forwards a demo-request submission to apps/web's
 * existing public lead-capture endpoint (apps/web/src/app/api/crm/public/
 * capture/[key]/route.ts) using its documented trusted-proxy contract — read
 * directly from that route's source, not inferred. This file must never be
 * imported from a "use client" component: CRM_CAPTURE_PROXY_SECRET must never
 * reach the browser.
 */

export interface DemoRequestPayload {
  firstName: string;
  lastName?: string;
  email: string;
  phone?: string;
  companyName?: string;
  jobTitle?: string;
  industry?: string;
  productInterest?: string;
  consentEmail?: boolean;
  /** Honeypot fields — must always be empty; forwarded as-is so the CRM's own check also applies. */
  websiteUrl?: string;
  companyWebsiteHidden?: string;
  customData?: Record<string, unknown>;
}

export interface CrmCaptureResult {
  ok: boolean;
  status: number;
  body: unknown;
}

function clientFingerprint(clientIp: string, userAgent: string): string {
  return createHash("sha256").update(`${clientIp}|${userAgent}`).digest("hex");
}

/**
 * Forwards a validated demo-request payload to apps/web's CRM capture
 * endpoint. Requires CRM_CAPTURE_FORM_KEY (which organization/form receives
 * the lead) and CRM_CAPTURE_PROXY_SECRET (shared with apps/web) to be
 * configured — if either is missing, this throws rather than silently
 * dropping the lead, so a misconfiguration is loud in server logs instead of
 * quietly losing submissions.
 */
export async function deliverDemoRequest(payload: DemoRequestPayload, clientIp: string, userAgent: string): Promise<CrmCaptureResult> {
  const formKey = process.env.CRM_CAPTURE_FORM_KEY?.trim();
  const secret = process.env.CRM_CAPTURE_PROXY_SECRET?.trim();
  if (!formKey || !secret) {
    throw new Error("CRM_CAPTURE_FORM_KEY / CRM_CAPTURE_PROXY_SECRET are not configured — lead delivery is unavailable.");
  }

  const rawBody = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const fingerprint = clientFingerprint(clientIp, userAgent);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${fingerprint}.${rawBody}`).digest("hex");

  const targetUrl = new URL(`/api/crm/public/capture/${formKey}`, APP_URL).toString();

  const response = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-vercentlabs-capture-timestamp": timestamp,
      "x-vercentlabs-capture-fingerprint": fingerprint,
      "x-vercentlabs-capture-signature": signature,
    },
    body: rawBody,
    signal: AbortSignal.timeout(10_000),
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // A non-JSON error response is still reported via response.ok/status below.
  }

  return { ok: response.ok, status: response.status, body };
}
