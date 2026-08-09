import { captureCrmLead } from "@vercentlabs/api";

import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/lib/billing";
import { rethrowCrmError } from "@/lib/crm";
import { publicCaptureSchema } from "@/lib/crm-validation";
import { query, transaction } from "@/lib/db";
import { errorResponse, HttpError, ok } from "@/lib/http";
import {
  directCaptureFingerprint,
  readRequestBytes,
  verifiedCaptureProxyFingerprint,
} from "@/lib/security";

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
    const trustedFingerprint = verifiedCaptureProxyFingerprint(request, rawBody);
    const directFingerprint = directCaptureFingerprint(request);

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
