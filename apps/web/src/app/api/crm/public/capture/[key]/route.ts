import { captureCrmLead } from "@vercentlabs/api";

import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/core/billing";
import { rethrowCrmError } from "@/modules/crm";
import { publicCaptureSchema } from "@/modules/crm/validation";
import { query, transaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";
import {
  directCaptureFingerprint,
  readRequestBytes,
  verifiedCaptureProxyFingerprint,
} from "@/core/security";

const PUBLIC_CAPTURE_KEY_PATTERN = /^[0-9a-f]{24,64}$/i;

export async function POST(
  request: Request,
  route: { params: Promise<{ key: string }> },
) {
  try {
    const { key } = await route.params;
    if (!PUBLIC_CAPTURE_KEY_PATTERN.test(key)) {
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
    const trustedFingerprint = verifiedCaptureProxyFingerprint(request, rawBody);
    const directFingerprint = directCaptureFingerprint(request);

    const result = await transaction((client) =>
      captureCrmLead(client, key, input, {
        origin: request.headers.get("origin") || "",
        fingerprint: trustedFingerprint || directFingerprint,
      }),
    );

    await incrementBillingUsage(organizationId, "api_requests_monthly");
    // F008 privacy boundary: public callers receive the same success shape
    // whether this submission created a Lead or was suppressed as an exact
    // duplicate. Never expose CRM membership, Lead IDs, owner, status or
    // duplicate existence to an unauthenticated submitter.
    const response = ok(
      {
        message: result.message || "Thanks. Your request has been received.",
        accepted: true,
      },
      201,
    );
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
