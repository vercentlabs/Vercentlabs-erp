import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { captureCrmLead } from "@vercent/api";

import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/lib/billing";
import { rethrowCrmError } from "@/lib/crm";
import { publicCaptureSchema } from "@/lib/crm-validation";
import { query, transaction } from "@/lib/db";
import { errorResponse, HttpError, ok } from "@/lib/http";
import { clientIp, readRequestBytes } from "@/lib/security";

const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

function safeHexEqual(left: string, right: string) {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function verifiedProxyFingerprint(request: Request, rawBody: string) {
  const timestamp = request.headers.get("x-vercent-capture-timestamp") || "";
  const fingerprint =
    request.headers.get("x-vercent-capture-fingerprint") || "";
  const signature = request.headers.get("x-vercent-capture-signature") || "";
  if (!timestamp && !fingerprint && !signature) return null;

  const secret = process.env.CRM_CAPTURE_PROXY_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new HttpError(503, "Trusted lead delivery is not configured.");
  }
  if (!/^\d{13}$/.test(timestamp) || !/^[0-9a-f]{64}$/i.test(fingerprint)) {
    throw new HttpError(401, "Invalid trusted lead-delivery signature.");
  }
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > SIGNATURE_MAX_AGE_MS) {
    throw new HttpError(401, "Trusted lead-delivery signature expired.");
  }
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${fingerprint}.${rawBody}`)
    .digest("hex");
  if (!safeHexEqual(signature, expected)) {
    throw new HttpError(401, "Invalid trusted lead-delivery signature.");
  }
  return `proxy:${fingerprint}`;
}

export async function POST(
  request: Request,
  route: { params: Promise<{ key: string }> },
) {
  try {
    const { key } = await route.params;
    if (!/^[0-9a-f]{36}$/i.test(key)) {
      throw new HttpError(404, "Lead-capture form not found.");
    }

    const formRows = await query<{ organization_id: string }>(
      "SELECT form.organization_id FROM tenant.crm_public_capture_form($1) AS form",
      [key],
    );
    const organizationId = formRows[0]?.organization_id;
    if (!organizationId) {
      throw new HttpError(404, "Lead-capture form not found.");
    }

    await requireBillingWriteAccess(organizationId);
    const bytes = await readRequestBytes(request, 50_000);
    const rawBody = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new HttpError(400, "Invalid JSON request.");
    }
    const input = publicCaptureSchema.parse(parsed);
    const trustedFingerprint = verifiedProxyFingerprint(request, rawBody);
    const directFingerprint = createHash("sha256")
      .update(`${clientIp(request)}|${request.headers.get("user-agent") || "unknown"}`)
      .digest("hex");

    const result = await transaction((client) =>
      captureCrmLead(client, key, input, {
        origin: request.headers.get("origin") || "",
        fingerprint: trustedFingerprint || directFingerprint,
      }),
    );

    await incrementBillingUsage(organizationId, "api_requests_monthly");
    const response = ok(result, 201);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
