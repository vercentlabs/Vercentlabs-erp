import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/lib/billing";
import { createHash } from "node:crypto";
import { captureCrmLead } from "@vercent/api";
import { getPool } from "@/lib/db";
import { rethrowCrmError } from "@/lib/crm";
import { publicCaptureSchema } from "@/lib/crm-validation";
import { errorResponse, ok, readJson } from "@/lib/http";
export async function POST(
  request: Request,
  route: { params: Promise<{ key: string }> },
) {
  const client = await getPool().connect();
  try {
    const { key } = await route.params;
    const formRows = await client.query<{
      organization_id: string;
    }>(
      "SELECT form.organization_id FROM tenant.crm_public_capture_form($1) AS form",
      [key],
    );

    const organizationId = formRows.rows[0]?.organization_id;

    if (organizationId) {
      await requireBillingWriteAccess(organizationId);

      await incrementBillingUsage(organizationId, "api_requests_monthly");
    }

    const input = publicCaptureSchema.parse(await readJson(request));
    await client.query("BEGIN");
    const raw = `${request.headers.get("x-forwarded-for") || "local"}|${request.headers.get("user-agent") || "unknown"}`;
    const result = await captureCrmLead(client, key, input, {
      origin: request.headers.get("origin") || "",
      fingerprint: createHash("sha256").update(raw).digest("hex"),
    });
    await client.query("COMMIT");
    return ok(result, 201);
  } catch (error) {
    await client.query("ROLLBACK");
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  } finally {
    client.release();
  }
}
