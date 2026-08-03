import {
  ingestTelephonyWebhook,
  verifyTelephonyWebhookSignature,
} from "@vercentlabs/api";
import { crmConversationIntelligenceErrorResponse } from "@/lib/crm-conversation-intelligence-route";
import { query, tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { readRequestBytes } from "@/lib/security";
export async function POST(
  request: Request,
  route: { params: Promise<{ provider: string }> },
) {
  try {
    const { provider } = await route.params;
    if (!["twilio", "exotel", "plivo", "mock", "custom"].includes(provider))
      throw new HttpError(404, "Telephony webhook not found.");
    const bytes = await readRequestBytes(request, 1000000);
    const rawBody = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const timestamp = request.headers.get("x-vercentlabs-timestamp") || "";
    const signature = request.headers.get("x-vercentlabs-signature") || "";
    const secret =
      process.env[`CRM_TELEPHONY_WEBHOOK_SECRET_${provider.toUpperCase()}`] ||
      process.env.CRM_TELEPHONY_WEBHOOK_SECRET ||
      "";
    if (
      !verifyTelephonyWebhookSignature({
        rawBody,
        timestamp,
        signature,
        secret,
      })
    )
      throw new HttpError(401, "Telephony webhook signature is invalid.");
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      throw new HttpError(400, "Invalid webhook JSON.");
    }
    const webhookKey = String(
      input.webhookKey ||
        input.webhook_key ||
        request.headers.get("x-vercentlabs-webhook-key") ||
        "",
    );
    const rows = await query<{
      organization_id: string;
      connection_id: string;
      provider: string;
      created_by: string;
    }>("SELECT * FROM tenant.crm_public_telephony_connection($1)", [
      webhookKey,
    ]);
    const connection = rows[0];
    if (!connection)
      throw new HttpError(404, "Telephony connection not found.");
    const context = {
      organizationId: connection.organization_id,
      userId: String(
        connection.created_by || "00000000-0000-4000-8000-000000000000",
      ),
      activeCompanyId: null,
      activeBranchId: null,
      allowAllCompanies: true,
    };
    const result = await tenantTransaction(
      connection.organization_id,
      (client) =>
        ingestTelephonyWebhook(
          client,
          context,
          connection.connection_id,
          provider,
          input,
        ),
    );
    return ok({ result });
  } catch (error) {
    return crmConversationIntelligenceErrorResponse(error);
  }
}
