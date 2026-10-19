// Renewal reminders (Shared Platform plan 2): before a paid subscription renews, its owners and billing managers are told when and
// how much — 14 days ahead for yearly billing, 3 days for monthly — once per period (organization_subscriptions.renewal_reminded_for
// holds the renewal date already announced). A subscription set to cancel at renewal is told that instead. Run by the worker's
// billing maintenance; each reminder is written in its company's own context (notifications are tenant-scoped).
import { setTenantContext } from "@vercentlabs/database";

import { chargedPerUserPaise } from "./catalogue.js";
import { createNotification } from "../platform/notifications/index.js";
import { inr, tx } from "./shared.js";

export const RENEWAL_NOTICE_DAYS = Object.freeze({ yearly: 14, monthly: 3 });

async function recipients(client, organizationId) {
  return (await client.query(
    `SELECT DISTINCT membership.user_id FROM public.organization_memberships membership
       JOIN public.user_role_assignments assignment ON assignment.organization_id = membership.organization_id AND assignment.user_id = membership.user_id
            AND assignment.status = 'active' AND (assignment.expires_at IS NULL OR assignment.expires_at > now())
       JOIN public.roles role ON role.id = assignment.role_id AND role.status = 'active'
      WHERE membership.organization_id = $1 AND membership.status = 'active'
        AND (role.slug = 'organization_owner' OR EXISTS (SELECT 1 FROM public.role_permissions permission WHERE permission.role_id = role.id AND permission.permission_key = 'billing.manage'))`,
    [organizationId])).rows.map((row) => row.user_id);
}

export async function sendRenewalReminders(client, { limit = 50, env = process.env } = {}) {
  const due = (await client.query(
    `SELECT s.organization_id, s.current_period_ends_at, s.current_period_ends_at::text AS ends_text, s.billing_period, s.paid_seats, s.cancel_at_cycle_end, price.amount_paise, plan.name AS plan_name
       FROM organization_subscriptions s
       JOIN billing_plan_prices price ON price.id = s.plan_price_id
       JOIN billing_plans plan ON plan.id = price.plan_id
      WHERE s.provider_subscription_id IS NOT NULL AND s.status IN ('active', 'authenticated') AND s.current_period_ends_at IS NOT NULL
        AND s.billing_period IN ('monthly', 'yearly') AND s.current_period_ends_at > now()
        AND s.current_period_ends_at <= now() + make_interval(days => CASE s.billing_period WHEN 'yearly' THEN $2::int ELSE $3::int END)
        AND (s.renewal_reminded_for IS NULL OR s.renewal_reminded_for <> s.current_period_ends_at)
      ORDER BY s.current_period_ends_at LIMIT $1`,
    [limit, RENEWAL_NOTICE_DAYS.yearly, RENEWAL_NOTICE_DAYS.monthly])).rows;
  let sent = 0;
  for (const row of due) {
    await tx(client, async () => {
      const claimed = await client.query(
        `UPDATE organization_subscriptions SET renewal_reminded_for = current_period_ends_at
          WHERE organization_id = $1 AND current_period_ends_at = $2::timestamptz AND (renewal_reminded_for IS NULL OR renewal_reminded_for <> current_period_ends_at) RETURNING id`,
        // The database's own text of the timestamp: a JavaScript Date would drop its microseconds and never match.
        [row.organization_id, row.ends_text]);
      if (!claimed.rows[0]) return;
      await setTenantContext(client, row.organization_id);
      const on = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date(row.current_period_ends_at));
      const users = Number(row.paid_seats);
      const amount = users * chargedPerUserPaise(row.amount_paise, env);
      const message = row.cancel_at_cycle_end
        ? `Your ${row.plan_name} subscription ends on ${on} and the company moves to the Free plan (1 user, 1 app). Keep it from Billing.`
        : `Your ${row.plan_name} subscription renews on ${on} for ${users} user${users === 1 ? "" : "s"}: ${inr(amount)} will be charged (${row.billing_period === "yearly" ? "yearly" : "monthly"}, GST included). Change users or billing in Billing before then.`;
      for (const userId of await recipients(client, row.organization_id)) {
        await createNotification(client, {
          organizationId: row.organization_id, userId, category: "billing_renewal",
          title: row.cancel_at_cycle_end ? `Subscription ends on ${on}` : `Subscription renews on ${on}`, message, href: "/settings/billing",
          entityType: "billing.subscription", entityId: row.organization_id,
        });
      }
      sent += 1;
    });
  }
  return sent;
}
