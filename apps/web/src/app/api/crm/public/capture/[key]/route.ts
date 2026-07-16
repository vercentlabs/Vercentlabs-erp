import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/lib/billing";
import { createHash } from "node:crypto";

import { captureCrmLead } from "@vercent/api";

import { rethrowCrmError } from "@/lib/crm";
import { publicCaptureSchema } from "@/lib/crm-validation";
import { query, transaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { clientIp } from "@/lib/security";

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
    const input = publicCaptureSchema.parse(await readJson(request));
    const fingerprintSource = `${clientIp(request)}|${request.headers.get("user-agent") || "unknown"}`;
    const result = await transaction((client) =>
      captureCrmLead(client, key, input, {
        origin: request.headers.get("origin") || "",
        fingerprint: createHash("sha256")
          .update(fingerprintSource)
          .digest("hex"),
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
