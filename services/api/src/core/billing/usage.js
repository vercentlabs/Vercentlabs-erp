// Usage the plans limit (Shared Platform plan 2): file storage and outbound messages (emails, SMS and WhatsApp messages the apps send
// to customers and suppliers). The owners and billing managers are told once when a company reaches 80% of an allowance (once per
// month for messages, once per crossing for storage); at the limit, enforce mode refuses the upload or the send with a clear message
// and observe mode only reports. Sign-in, password and invitation emails are never counted.
import { createNotification } from "../platform/notifications/index.js";

import { billingEnforcementMode } from "./enforcement.js";
import { getBillingSummary, incrementBillingUsage } from "./entitlements.js";

export const USAGE_WARNING_PERCENT = 80;
const GB = 1024 * 1024 * 1024;

export class UsageLimitError extends Error {
  constructor(message, code, details = undefined) {
    super(message);
    this.name = "UsageLimitError";
    this.status = 402;
    this.code = code;
    this.details = details;
  }
}

async function billingRecipients(client, organizationId) {
  return (await client.query(
    `SELECT DISTINCT membership.user_id FROM public.organization_memberships membership
       JOIN public.user_role_assignments assignment ON assignment.organization_id = membership.organization_id AND assignment.user_id = membership.user_id
            AND assignment.status = 'active' AND (assignment.expires_at IS NULL OR assignment.expires_at > now())
       JOIN public.roles role ON role.id = assignment.role_id AND role.status = 'active'
      WHERE membership.organization_id = $1 AND membership.status = 'active'
        AND (role.slug = 'organization_owner' OR EXISTS (SELECT 1 FROM public.role_permissions permission WHERE permission.role_id = role.id AND permission.permission_key = 'billing.manage'))`,
    [organizationId])).rows.map((row) => row.user_id);
}

async function tell(client, organizationId, { title, message }) {
  for (const userId of await billingRecipients(client, organizationId)) {
    await createNotification(client, { organizationId, userId, category: "billing_usage", title, message, href: "/settings/billing", entityType: "billing.usage", entityId: organizationId });
  }
}

const percent = (used, limit) => (limit > 0 ? Math.round((used / limit) * 100) : 0);

// ---------------------------------------------------------------- storage

// Bytes of file content the company keeps (current and earlier versions; content already removed is not counted).
export async function storageUsedBytes(client, organizationId) {
  return Number((await client.query(
    `SELECT COALESCE(sum(size_bytes), 0)::bigint AS bytes FROM public.attachments WHERE organization_id = $1 AND content_removed_at IS NULL`,
    [organizationId])).rows[0].bytes);
}

// Called before a file is stored. Refuses (enforce mode) a file that would take the company past its storage, and tells the owners
// when it crosses 80%.
export async function assertStorageAvailable(client, organizationId, additionalBytes, env = process.env) {
  let summary;
  try { summary = await getBillingSummary(client, organizationId, env); } catch { return null; }
  const limit = Number(summary.limits?.storage_gb ?? 0) * GB;
  if (!(limit > 0)) return null;
  const used = await storageUsedBytes(client, organizationId);
  const after = used + Math.max(0, Number(additionalBytes) || 0);
  if (after > limit && billingEnforcementMode(env) === "enforce") {
    throw new UsageLimitError(
      `Your ${summary.planName} plan's ${summary.limits.storage_gb} GB of file storage is full. Remove old files or upgrade in Billing to upload more.`,
      "BILLING_STORAGE_FULL", { usedBytes: used, limitBytes: limit });
  }
  if (percent(after, limit) >= USAGE_WARNING_PERCENT && percent(used, limit) < USAGE_WARNING_PERCENT) {
    await tell(client, organizationId, {
      title: `File storage is ${percent(after, limit)}% full`,
      message: `${(after / GB).toFixed(1)} GB of the ${summary.limits.storage_gb} GB on your ${summary.planName} plan is used. At the limit, new uploads stop.`,
    });
  }
  return { usedBytes: after, limitBytes: limit };
}

// ---------------------------------------------------------------- outbound messages

// Counts messages a company sends (an email, SMS or WhatsApp message to a customer or supplier; a campaign counts each recipient).
// `idempotencyKey` makes a retried send count once. Refuses in enforce mode at the monthly limit.
export async function countOutboundMessages(client, organizationId, { quantity = 1, channel = "email", idempotencyKey = "" } = {}, env = process.env) {
  let result;
  try {
    result = await incrementBillingUsage(client, organizationId, "outbound_messages_monthly", quantity, { idempotencyKey, source: `message:${channel}`, env });
  } catch (error) {
    if (error?.status === 402 && /allowance/.test(String(error.message))) {
      throw new UsageLimitError("This month's message allowance on your plan is used up. Messages can be sent again next month, or upgrade in Billing.", "BILLING_MESSAGES_USED_UP");
    }
    throw error;
  }
  if (result.replayed || result.quantity === null) return result;
  const summary = await getBillingSummary(client, organizationId, env);
  const limit = Number(summary.limits?.outbound_messages_monthly ?? 0);
  if (limit > 0 && percent(result.quantity, limit) >= USAGE_WARNING_PERCENT) {
    const stamped = await client.query(
      `UPDATE billing_usage_monthly SET warned_at = now()
        WHERE organization_id = $1 AND month_start = date_trunc('month', current_date)::date AND metric = 'outbound_messages_monthly' AND warned_at IS NULL
        RETURNING quantity`, [organizationId]);
    if (stamped.rows[0]) {
      await tell(client, organizationId, {
        title: `${percent(result.quantity, limit)}% of this month's messages used`,
        message: `${result.quantity} of the ${limit} emails, SMS and WhatsApp messages on your ${summary.planName} plan are used this month. At the limit, sending stops until next month.`,
      });
    }
  }
  return result;
}

// The usage panel on the Billing page.
export async function getUsageOverview(client, organizationId, env = process.env) {
  const summary = await getBillingSummary(client, organizationId, env);
  const storageLimit = Number(summary.limits?.storage_gb ?? 0) * GB;
  const used = await storageUsedBytes(client, organizationId);
  const messages = Number(summary.usage?.outbound_messages_monthly ?? 0);
  const messageLimit = Number(summary.limits?.outbound_messages_monthly ?? 0);
  return {
    storage: { usedBytes: used, limitBytes: storageLimit, percent: percent(used, storageLimit) },
    messages: { used: messages, limit: messageLimit, percent: percent(messages, messageLimit) },
    warningPercent: USAGE_WARNING_PERCENT,
    enforced: billingEnforcementMode(env) === "enforce",
  };
}
