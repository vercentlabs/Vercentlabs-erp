import {
  captureCrmLead,
  directCaptureFingerprint,
  incrementBillingUsage,
  readRequestBytes,
  requireBillingWriteAccess,
  resolvePublicCaptureOrganization,
  verifiedCaptureProxyFingerprint,
} from "@vercentlabs/api";

import { tenantTransaction, withIngressClient } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";
import { publicCaptureSchema } from "@/features/crm/public-capture/capture-schema";

const PUBLIC_CAPTURE_KEY_PATTERN = /^[0-9a-f]{24,64}$/i;

// Public web-to-lead capture (the landing demo form through its signed
// trusted proxy, or a customer's site). The capture-form key is the
// credential: it resolves the organisation through a narrow definer function
// (ingress, no organisation context), then everything runs in that
// organisation's context. The form's allowed origins, honeypots, required
// fields and per-fingerprint hourly rate limit are enforced by the domain;
// a signed proxy submission (landing) is verified by HMAC over the raw body.
// A capture is a business write: it needs an active subscription.
export async function POST(request: Request, route: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await route.params;
    if (!PUBLIC_CAPTURE_KEY_PATTERN.test(key)) throw new HttpError(404, "Lead-capture form not found.");
    const organizationId = await withIngressClient((client) => resolvePublicCaptureOrganization(client, key));
    if (!organizationId) throw new HttpError(404, "Lead-capture form not found.");

    const bytes = await readRequestBytes(request, 50_000);
    const rawBody = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new HttpError(400, "Invalid JSON request.");
    }
    const input = publicCaptureSchema.parse(parsed);
    const fingerprint = verifiedCaptureProxyFingerprint(request, rawBody, process.env) || directCaptureFingerprint(request, process.env);

    const result = await tenantTransaction(organizationId, async (client) => {
      await requireBillingWriteAccess(client, organizationId, process.env);
      const captured = await captureCrmLead(client, key, input, { origin: request.headers.get("origin") || "", fingerprint });
      await incrementBillingUsage(client, organizationId, "api_requests_monthly", 1, { source: "crm.public_capture", env: process.env });
      return captured;
    });
    // Same response whether the submission created a Lead or was suppressed
    // as an exact duplicate: never reveal CRM membership to the public.
    const response = ok({ message: result?.message || "Thanks. Your request has been received.", accepted: true }, 201);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
