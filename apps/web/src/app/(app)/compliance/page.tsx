import Link from "next/link";
import { notFound } from "next/navigation";

import { getPrivacyRetentionDashboard } from "@vercentlabs/api";

import AppIcon from "@/components/app-icon";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { getBillingSummary } from "@/lib/billing";
import { crmContext } from "@/lib/crm";
import { query, tenantTransaction } from "@/lib/db";

export const metadata = { title: "Compliance" };
export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

// Governance-relevant event-type prefixes only — a small, fixed allowlist
// (never client-controlled), matching the same pattern
// lib/audit/query.ts's Security Events view uses.
const GOVERNANCE_EVENT_PREFIXES = ["crm.privacy.", "billing.", "module.", "access."];

export default async function CompliancePage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.complianceView)) notFound();

  const organizationId = session.organizationId as string;
  const canManagePrivacy = hasPermission(session, PERMISSIONS.crmPrivacyManage);

  const [retention, requestCounts, consentCount, billing, recentActivity] =
    await Promise.allSettled([
      tenantTransaction(organizationId, (client) =>
        getPrivacyRetentionDashboard(client, crmContext(session)),
      ),
      query<{ status: string; count: number }>(
        `SELECT status, count(*)::int AS count FROM tenant.crm_privacy_requests
          WHERE organization_id = $1 GROUP BY status`,
        [organizationId],
      ),
      query<{ count: number }>(
        `SELECT count(*)::int AS count FROM tenant.crm_consent_events
          WHERE organization_id = $1 AND occurred_at >= now() - interval '30 days'`,
        [organizationId],
      ),
      getBillingSummary(organizationId),
      query<{ event_type: string; entity_type: string; created_at: Date; actor_name: string | null }>(
        `SELECT a.event_type, a.entity_type, a.created_at, u.full_name AS actor_name
           FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
          WHERE a.organization_id = $1
            AND (${GOVERNANCE_EVENT_PREFIXES.map((_, index) => `a.event_type LIKE $${index + 2}`).join(" OR ")})
          ORDER BY a.created_at DESC LIMIT 6`,
        [organizationId, ...GOVERNANCE_EVENT_PREFIXES.map((prefix) => `${prefix}%`)],
      ),
    ]);

  const activePolicies =
    retention.status === "fulfilled"
      ? Number((retention.value as Row).metrics && ((retention.value as Row).metrics as Row).activePolicies || 0)
      : 0;
  const openRequestStatuses = new Set(["received", "verification_pending", "in_progress"]);
  const openRequests =
    requestCounts.status === "fulfilled"
      ? requestCounts.value.reduce(
          (sum, row) => (openRequestStatuses.has(row.status) ? sum + row.count : sum),
          0,
        )
      : 0;
  const consentEvents30d = consentCount.status === "fulfilled" ? consentCount.value[0]?.count || 0 : 0;
  const subscriptionStatus = billing.status === "fulfilled" ? billing.value.status : "unknown";
  const writeAccess = billing.status === "fulfilled" ? billing.value.writeAccess : true;
  const activity = recentActivity.status === "fulfilled" ? recentActivity.value : [];

  const cards = [
    {
      label: "Privacy & retention (CRM)",
      value: `${activePolicies} active ${activePolicies === 1 ? "policy" : "policies"}`,
      href: "/compliance/retention",
      icon: "security" as const,
    },
    {
      label: "Open privacy requests",
      value: String(openRequests),
      href: "/compliance/privacy-requests",
      icon: "notifications" as const,
      attention: openRequests > 0,
    },
    {
      label: "Consent events (30 days)",
      value: String(consentEvents30d),
      href: "/compliance/consent",
      icon: "audit" as const,
    },
    {
      label: "Billing & payment health",
      value: subscriptionStatus.replaceAll("_", " "),
      href: "/billing",
      icon: "billing" as const,
      attention: !writeAccess,
    },
    {
      label: "Audit trail",
      value: "Enabled",
      href: "/audit-logs",
      icon: "audit" as const,
    },
    {
      label: "Data governance",
      value: "Overview",
      href: "/compliance/data-governance",
      icon: "modules" as const,
    },
  ];

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Governance · Compliance</p>
          <h1>Compliance overview</h1>
          <p>
            Privacy controls, retention configuration and auditability across
            the workspace. Status shown here is only what the platform can
            actually prove — not a certification claim.
          </p>
        </div>
      </section>

      <section className="metric-grid" aria-label="Compliance status">
        {cards.map((card) => (
          <Link
            className={`metric-card${card.attention ? " attention" : ""}`}
            href={card.href}
            key={card.label}
          >
            <span className="metric-icon" aria-hidden="true">
              <AppIcon name={card.icon} size={21} />
            </span>
            <span className="metric-copy">
              <small>{card.label}</small>
              <strong>{card.value}</strong>
            </span>
            <AppIcon className="metric-arrow" name="arrow-right" size={17} />
          </Link>
        ))}
      </section>

      <section className="dashboard-section" aria-labelledby="governance-activity-title">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Recent activity</p>
            <h2 id="governance-activity-title">Latest governance events</h2>
          </div>
          <Link href="/audit-logs">
            Open audit logs <AppIcon name="arrow-right" size={16} />
          </Link>
        </div>
        <div className="stack-list audit-list">
          {activity.map((event, index) => (
            <div key={`${event.event_type}-${index}`}>
              <span className="audit-event-icon" aria-hidden="true">
                <AppIcon name="security" size={16} />
              </span>
              <div>
                <strong>{event.event_type.replaceAll("_", " ")}</strong>
                <span>
                  {event.actor_name || "System"} ·{" "}
                  {new Intl.DateTimeFormat("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(event.created_at)}
                </span>
              </div>
              <small>{event.entity_type.replaceAll("_", " ")}</small>
            </div>
          ))}
          {!activity.length ? (
            <div className="empty-state compact">
              <span className="empty-state-icon" aria-hidden="true">
                <AppIcon name="audit" size={20} />
              </span>
              <div>
                <strong>No governance activity recorded yet</strong>
                <p>Privacy, billing and access-control changes will appear here.</p>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {!canManagePrivacy ? (
        <p className="notice">
          You can view compliance status. Managing retention policies and
          privacy requests requires CRM privacy management access.
        </p>
      ) : null}
    </>
  );
}
