import {
  ingestCalendarDelta,
  ingestMailboxDelta,
  recordEmailEngagementEvent,
  verifyCrmProviderWebhookSignature,
} from "@vercentlabs/api";
import { crmCommunicationsErrorResponse } from "@/lib/crm-communications-route";
import { query, tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { readRequestBytes } from "@/lib/security";

export async function POST(
  request: Request,
  route: { params: Promise<{ provider: string }> },
) {
  try {
    const { provider } = await route.params;
    if (!["gmail", "microsoft365", "delivery"].includes(provider)) {
      throw new HttpError(404, "Provider webhook not found.");
    }
    const bytes = await readRequestBytes(request, 1000000);
    const rawBody = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const timestamp = request.headers.get("x-vercentlabs-timestamp") || "";
    const signature = request.headers.get("x-vercentlabs-signature") || "";
    const secret =
      process.env[`CRM_PROVIDER_WEBHOOK_SECRET_${provider.toUpperCase()}`] ||
      process.env.CRM_PROVIDER_WEBHOOK_SECRET ||
      "";
    if (
      !verifyCrmProviderWebhookSignature({
        rawBody,
        timestamp,
        signature,
        secret,
      })
    ) {
      throw new HttpError(401, "Provider webhook signature is invalid.");
    }
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      throw new HttpError(400, "Invalid webhook JSON.");
    }
    const subscriptionId = String(
      input.subscriptionId ||
        input.subscription_id ||
        request.headers.get("x-vercentlabs-subscription-id") ||
        "",
    );
    const rows = await query<{
      organization_id: string;
      sync_account_id: string;
      provider: string;
    }>("SELECT * FROM tenant.crm_public_sync_account($1)", [subscriptionId]);
    const account = rows[0];
    if (!account) throw new HttpError(404, "Sync subscription not found.");
    const context = {
      organizationId: account.organization_id,
      userId: String(
        input.userId || input.user_id || "00000000-0000-4000-8000-000000000000",
      ),
      activeCompanyId: null,
      activeBranchId: null,
      allowAllCompanies: true,
    };
    const result = await tenantTransaction(
      account.organization_id,
      async (client) => {
        const owner = await client.query(
          "SELECT user_id FROM tenant.crm_sync_accounts WHERE organization_id=$1 AND id=$2",
          [account.organization_id, account.sync_account_id],
        );
        context.userId = String(owner.rows[0]?.user_id || context.userId);
        if (input.eventType || input.event_type) {
          return recordEmailEngagementEvent(client, context, {
            ...input,
            provider: input.provider || provider,
            eventType: input.eventType || input.event_type,
          });
        }
        if (input.syncType === "calendar") {
          return ingestCalendarDelta(client, context, account.sync_account_id, {
            ...input,
            provider: account.provider,
          });
        }
        if (Array.isArray(input.messages)) {
          return ingestMailboxDelta(client, context, account.sync_account_id, {
            ...input,
            provider: account.provider,
          });
        }
        await client.query(
          `INSERT INTO tenant.crm_provider_sync_jobs(organization_id,sync_account_id,sync_type,status,metadata)
         VALUES($1,$2,$3,'queued',$4)`,
          [
            account.organization_id,
            account.sync_account_id,
            input.syncType === "calendar" ? "calendar" : "mailbox",
            JSON.stringify({ provider, notification: input }),
          ],
        );
        return { queued: true };
      },
    );
    return ok({ result });
  } catch (error) {
    return crmCommunicationsErrorResponse(error);
  }
}
