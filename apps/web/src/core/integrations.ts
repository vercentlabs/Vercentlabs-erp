// Prompt 10 (Administration Foundation) — Integrations workspace data
// access, extended by Prompt 13 (Worker & Scheduler Foundation). Confirmed
// by direct audit: outbound webhook SUBSCRIPTION management is real
// (tenant.crm_webhook_subscriptions, a registered CRM resource, CRUD
// works today). Before Prompt 13, tenant.crm_outbox_events was written on
// real business events and never read/claimed/delivered by any worker.
// Prompt 13 built services/worker, a real standalone delivery process —
// this file now surfaces genuine delivery status (queue depth per real
// status, a recent-deliveries preview) instead of the prior "no delivery
// worker exists" disclosure. Still never a fabricated "Connected"/healthy
// status: if the worker process is not currently running, the queue
// simply stops draining and this page's own real counts show that
// honestly (a growing 'pending' bucket), rather than claiming health it
// cannot verify.
import { listCrmRecords } from "@vercentlabs/api";

import type { WorkspaceSessionContext } from "@/core/auth";
import { crmContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { redactAuditPayload } from "@/core/audit/redact";

export type WebhookSubscriptionRow = {
  id: string;
  name: string;
  endpointUrl: string;
  eventTypes: string[];
  secretReference: string | null;
  status: string;
};

export async function listWebhookSubscriptions(
  session: WorkspaceSessionContext,
): Promise<WebhookSubscriptionRow[]> {
  try {
    const context = crmContext(session);
    const { rows } = await tenantTransaction(session.organizationId, (client) =>
      listCrmRecords(client, context, "webhook-subscriptions", { status: "all", limit: 100 }),
    );
    return rows as WebhookSubscriptionRow[];
  } catch {
    return [];
  }
}

export type OutboxQueueStatus = { status: string; count: number };

export async function getOutboxQueueStatus(
  session: WorkspaceSessionContext,
): Promise<OutboxQueueStatus[]> {
  try {
    return await tenantTransaction(session.organizationId, async (client) => {
      const { rows } = await client.query(
        `SELECT status, count(*)::int AS count
           FROM tenant.crm_outbox_events
          WHERE organization_id = $1
          GROUP BY status`,
        [session.organizationId],
      );
      return rows;
    });
  } catch {
    return [];
  }
}

export type WebhookDeliveryRow = {
  id: string;
  event_type: string;
  status: string;
  attempt_count: number;
  delivered_at: string | null;
  next_attempt_at: string | null;
  last_error: unknown;
  created_at: string;
};

// Recent delivery attempts, redacted with the same Prompt 9 utility every
// other governance surface uses — an outbox last_error can echo back
// response-body fragments from an arbitrary external endpoint, so it goes
// through redactAuditPayload() exactly like audit-log payloads do before
// ever reaching this page.
export async function listRecentWebhookDeliveries(
  session: WorkspaceSessionContext,
  { limit = 20 }: { limit?: number } = {},
): Promise<WebhookDeliveryRow[]> {
  try {
    return await tenantTransaction(session.organizationId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, event_type, status, attempt_count, delivered_at, next_attempt_at, last_error, created_at
           FROM tenant.crm_outbox_events
          WHERE organization_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [session.organizationId, Math.min(Math.max(Number(limit) || 20, 1), 100)],
      );
      return rows.map((row: WebhookDeliveryRow) => ({ ...row, last_error: redactAuditPayload(row.last_error) }));
    });
  } catch {
    return [];
  }
}

export function isSystemEmailConfigured(): { transport: "smtp" | "webhook" | "none" } {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD) {
    return { transport: "smtp" };
  }
  if (process.env.AUTH_EMAIL_WEBHOOK_URL) {
    return { transport: "webhook" };
  }
  return { transport: "none" };
}
