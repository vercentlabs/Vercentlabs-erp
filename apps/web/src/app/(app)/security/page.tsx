import Link from "next/link";

import AppIcon from "@/shared/components/app-icon";
import ChangePasswordForm from "@/core/components/change-password-form";
import SessionManager from "@/core/components/session-manager";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { query } from "@/core/db";
import { listSecurityAuditEvents } from "@/core/audit/query";

export const metadata = { title: "Account security" };
export const dynamic = "force-dynamic";

// Field-level protections are still exactly these three (Prompt 3) —
// there is no generic/configurable field-security policy engine, so this
// stays a static, accurate list rather than a "configure field security"
// control (Part 54: "Do not claim generic customizable field-security
// policies unless implemented").
const FIELD_LEVEL_PROTECTIONS = [
  "HR & Payroll — employee sensitive fields (bank details, PII, statutory identifiers)",
  "Procurement — supplier banking fields",
  "Support — private communication notes",
];

export default async function SecurityPage() {
  const session = await requireWorkspace();
  const organizationId = session.organizationId as string;

  const rows = await query<{
    id: string;
    device_name: string | null;
    ip_address: string | null;
    created_at: Date;
    last_seen_at: Date;
    expires_at: Date;
  }>(
    `
    SELECT id, device_name, ip_address, created_at, last_seen_at, expires_at
    FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now() AND idle_expires_at>now()
    ORDER BY last_seen_at DESC
  `,
    [session.userId],
  );
  const sessions = rows.map((row) => ({
    id: row.id,
    deviceName: row.device_name || "Unknown device",
    ipAddress: row.ip_address,
    createdAt: row.created_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  }));

  // Org-wide overview is a separate, additionally-gated section — the
  // page above stays open to any authenticated member for their OWN
  // password/sessions (unchanged), matching the Critical Principle:
  // governance-level visibility requires a governance permission, not
  // just authentication.
  const canViewOverview = hasPermission(session, PERMISSIONS.auditView);
  let overview: {
    activeSessions: number;
    roleCount: number;
    membersWithCompanyAccess: number;
    totalActiveMembers: number;
    recentEvents: Awaited<ReturnType<typeof listSecurityAuditEvents>>["rows"];
  } | null = null;

  if (canViewOverview) {
    const [{ active_sessions }] = await query<{ active_sessions: number }>(
      `SELECT count(*)::int AS active_sessions
         FROM sessions s
         JOIN organization_memberships om ON om.user_id = s.user_id AND om.organization_id = $1
        WHERE s.revoked_at IS NULL AND s.expires_at > now() AND s.idle_expires_at > now()`,
      [organizationId],
    );
    const [{ role_count }] = await query<{ role_count: number }>(
      `SELECT count(*)::int AS role_count FROM roles WHERE organization_id=$1 AND status='active'`,
      [organizationId],
    );
    const [{ members_with_company_access, total_active_members }] = await query<{
      members_with_company_access: number;
      total_active_members: number;
    }>(
      `SELECT
         (SELECT count(DISTINCT user_id)::int FROM membership_company_access WHERE organization_id=$1) AS members_with_company_access,
         (SELECT count(*)::int FROM organization_memberships WHERE organization_id=$1 AND status='active') AS total_active_members`,
      [organizationId],
    );
    const security = await listSecurityAuditEvents(organizationId, { pageSize: 5 });
    overview = {
      activeSessions: active_sessions,
      roleCount: role_count,
      membersWithCompanyAccess: members_with_company_access,
      totalActiveMembers: total_active_members,
      recentEvents: security.rows,
    };
  }

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Account security</p>
          <h1>Password and sessions</h1>
          <p>
            Change your password, review active devices and revoke access you no
            longer recognise.
          </p>
        </div>
      </section>
      <section className="content-grid">
        <article className="panel">
          <p className="eyebrow">Password</p>
          <h2>Change your password</h2>
          <ChangePasswordForm />
        </article>
        <article className="panel">
          <SessionManager
            sessions={sessions}
            currentSessionId={session.sessionId}
          />
        </article>
      </section>
      <section className="panel muted-panel">
        <p className="eyebrow">Multi-factor authentication</p>
        <h2>Not yet enrollable</h2>
        <p>
          The database tracks an MFA policy flag and an enrolment timestamp
          per user, but no authenticator-enrolment or verification flow
          exists yet — MFA cannot currently be turned on for any account.
        </p>
      </section>

      {overview ? (
        <>
          <section className="page-heading">
            <div>
              <p className="eyebrow">Governance · Security</p>
              <h1>Organisation security overview</h1>
              <p>
                Real, currently-enforced controls only — no fabricated
                security score.
              </p>
            </div>
          </section>

          <section className="metric-grid" aria-label="Security overview">
            <article className="metric-card static">
              <span className="metric-icon" aria-hidden="true">
                <AppIcon name="security" size={21} />
              </span>
              <span className="metric-copy">
                <small>Active sessions</small>
                <strong>{overview.activeSessions}</strong>
              </span>
            </article>
            <article className="metric-card static">
              <span className="metric-icon" aria-hidden="true">
                <AppIcon name="roles" size={21} />
              </span>
              <span className="metric-copy">
                <small>Active roles</small>
                <strong>{overview.roleCount}</strong>
              </span>
            </article>
            <article className="metric-card static">
              <span className="metric-icon" aria-hidden="true">
                <AppIcon name="companies" size={21} />
              </span>
              <span className="metric-copy">
                <small>Members with company scope set</small>
                <strong>
                  {overview.membersWithCompanyAccess} / {overview.totalActiveMembers}
                </strong>
              </span>
            </article>
            <article className="metric-card static">
              <span className="metric-icon" aria-hidden="true">
                <AppIcon name="security" size={21} />
              </span>
              <span className="metric-copy">
                <small>MFA</small>
                <strong>Not yet enrollable</strong>
              </span>
            </article>
          </section>

          <section className="dashboard-section" aria-labelledby="field-level-title">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Field-level access</p>
                <h2 id="field-level-title">Protected fields</h2>
              </div>
              <Link href="/settings/roles">
                Roles &amp; permissions <AppIcon name="arrow-right" size={16} />
              </Link>
            </div>
            <ul className="plain-list">
              {FIELD_LEVEL_PROTECTIONS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="billing-commercial-note">
              Record-level access today is CRM ownership scoping plus
              company/branch scope and tenant row-level security — there is
              no generic, configurable record-sharing rule engine beyond
              those.
            </p>
          </section>

          <section className="dashboard-section" aria-labelledby="security-log-title">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Security logs</p>
                <h2 id="security-log-title">Recent security events</h2>
              </div>
              <Link href="/audit-logs/security">
                Open security events <AppIcon name="arrow-right" size={16} />
              </Link>
            </div>
            <div className="stack-list">
              {overview.recentEvents.map((event) => (
                <div key={event.id}>
                  <div>
                    <strong>{event.event_type.replaceAll("_", " ")}</strong>
                    <span>{event.actor_name || "System"}</span>
                  </div>
                  <small>
                    {new Intl.DateTimeFormat("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(event.created_at)}
                  </small>
                </div>
              ))}
              {!overview.recentEvents.length ? (
                <div className="empty-state compact">
                  <span className="empty-state-icon" aria-hidden="true">
                    <AppIcon name="security" size={20} />
                  </span>
                  <div>
                    <strong>No security events recorded yet</strong>
                    <p>Authentication, access and module-enablement changes will appear here.</p>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
