import Link from "next/link";

import AppIcon, { type AppIconName } from "@/components/app-icon";
import { requireWorkspace } from "@/lib/auth";
import { query } from "@/lib/db";

export const metadata = { title: "Dashboard" };

function formatTime(value: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function DashboardPage() {
  const session = await requireWorkspace();
  const organizationId = session.organizationId as string;
  const [counts] = await query<{
    companies: number;
    branches: number;
    users: number;
    departments: number;
    pending_approvals: number;
    unread_notifications: number;
  }>(
    `
      SELECT
        (SELECT count(*)::int FROM companies WHERE organization_id=$1 AND status='active') AS companies,
        (SELECT count(*)::int FROM branches WHERE organization_id=$1 AND status='active') AS branches,
        (SELECT count(*)::int FROM organization_memberships WHERE organization_id=$1 AND status='active') AS users,
        (SELECT count(*)::int FROM departments WHERE organization_id=$1 AND status='active') AS departments,
        (SELECT count(*)::int FROM approval_requests WHERE organization_id=$1 AND status='pending') AS pending_approvals,
        (SELECT count(*)::int FROM notifications WHERE organization_id=$1 AND user_id=$2 AND read_at IS NULL) AS unread_notifications
    `,
    [organizationId, session.userId],
  );

  const recentEvents = await query<{
    event_type: string;
    entity_type: string;
    created_at: Date;
    actor_name: string | null;
  }>(
    `
      SELECT a.event_type, a.entity_type, a.created_at, u.full_name AS actor_name
      FROM audit_events a LEFT JOIN users u ON u.id=a.actor_user_id
      WHERE a.organization_id=$1 ORDER BY a.created_at DESC LIMIT 6
    `,
    [organizationId],
  );

  const activities = await query<{
    id: string;
    title: string;
    due_at: Date | null;
  }>(
    `
      SELECT id, title, due_at FROM activities
      WHERE organization_id=$1 AND assigned_to=$2 AND completed_at IS NULL
      ORDER BY due_at ASC NULLS LAST LIMIT 6
    `,
    [organizationId, session.userId],
  );

  const metrics: Array<{
    label: string;
    value: number;
    description: string;
    icon: AppIconName;
    href: string;
    attention?: boolean;
  }> = [
    {
      label: "Companies",
      value: counts?.companies || 0,
      description: "Active legal entities",
      icon: "companies",
      href: "/settings/companies",
    },
    {
      label: "Branches",
      value: counts?.branches || 0,
      description: "Operating locations",
      icon: "branches",
      href: "/settings/branches",
    },
    {
      label: "Active users",
      value: counts?.users || 0,
      description: "People with workspace access",
      icon: "users",
      href: "/settings/users",
    },
    {
      label: "Departments",
      value: counts?.departments || 0,
      description: "Configured responsibility units",
      icon: "departments",
      href: "/settings/departments",
    },
    {
      label: "Pending approvals",
      value: counts?.pending_approvals || 0,
      description: "Decisions awaiting action",
      icon: "approvals",
      href: "/approvals",
      attention: Boolean(counts?.pending_approvals),
    },
    {
      label: "Unread notifications",
      value: counts?.unread_notifications || 0,
      description: "New workspace updates",
      icon: "notifications",
      href: "/notifications",
      attention: Boolean(counts?.unread_notifications),
    },
  ];

  const quickActions: Array<{
    href: string;
    label: string;
    description: string;
    icon: AppIconName;
  }> = [
    {
      href: "/settings/companies",
      label: "Add company",
      description: "Expand the legal entity structure",
      icon: "companies",
    },
    {
      href: "/settings/branches",
      label: "Add branch",
      description: "Create another operating location",
      icon: "branches",
    },
    {
      href: "/settings/users",
      label: "Invite user",
      description: "Give a team member controlled access",
      icon: "users",
    },
    {
      href: "/settings/roles",
      label: "Configure roles",
      description: "Define least-privilege permissions",
      icon: "roles",
    },
  ];

  const today = new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return (
    <>
      <section className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <p className="dashboard-date">{today}</p>
          <p className="eyebrow">ERP workspace</p>
          <h1>Welcome back, {session.fullName.split(" ")[0]}.</h1>
          <p>
            Review what needs attention, maintain the organisation foundation
            and move into the right operating context.
          </p>
          <div className="dashboard-hero-actions">
            <Link className="primary-button inverse" href="/modules">
              <AppIcon name="modules" size={18} /> Open modules
            </Link>
            <Link className="secondary-button inverse" href="/settings">
              <AppIcon name="settings" size={18} /> Workspace settings
            </Link>
          </div>
        </div>
        <aside
          className="dashboard-context-card"
          aria-label="Current operating context"
        >
          <div className="dashboard-context-heading">
            <span aria-hidden="true">
              <AppIcon name="organisation" size={20} />
            </span>
            <div>
              <small>Current context</small>
              <strong>{session.organizationName}</strong>
            </div>
          </div>
          <dl>
            <div>
              <dt>Company</dt>
              <dd>{session.companyName || "Not selected"}</dd>
            </div>
            <div>
              <dt>Branch</dt>
              <dd>{session.branchName || "All branches"}</dd>
            </div>
            <div>
              <dt>Access</dt>
              <dd>
                {session.roleSlugs[0]?.replaceAll("_", " ") ||
                  session.membershipRole}
              </dd>
            </div>
          </dl>
          <span className="status-badge success">
            <span aria-hidden="true" /> Platform foundation active
          </span>
        </aside>
      </section>

      <section className="dashboard-section" aria-labelledby="overview-title">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">At a glance</p>
            <h2 id="overview-title">Organisation overview</h2>
          </div>
          <Link href="/audit-logs">
            Review governance <AppIcon name="arrow-right" size={16} />
          </Link>
        </div>
        <div className="metric-grid">
          {metrics.map((metric) => (
            <Link
              className={`metric-card${metric.attention ? " attention" : ""}`}
              href={metric.href}
              key={metric.label}
            >
              <span className="metric-icon" aria-hidden="true">
                <AppIcon name={metric.icon} size={21} />
              </span>
              <span className="metric-copy">
                <small>{metric.label}</small>
                <strong>{metric.value}</strong>
                <span>{metric.description}</span>
              </span>
              <AppIcon className="metric-arrow" name="arrow-right" size={17} />
            </Link>
          ))}
        </div>
      </section>

      <section
        className="dashboard-section"
        aria-labelledby="quick-actions-title"
      >
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Common actions</p>
            <h2 id="quick-actions-title">Keep the foundation current</h2>
          </div>
        </div>
        <div className="quick-actions">
          {quickActions.map((action) => (
            <Link href={action.href} key={action.href}>
              <span aria-hidden="true">
                <AppIcon name={action.icon} size={20} />
              </span>
              <div>
                <strong>{action.label}</strong>
                <small>{action.description}</small>
              </div>
              <AppIcon name="arrow-right" size={16} />
            </Link>
          ))}
        </div>
      </section>

      <section className="content-grid dashboard-panels">
        <article className="panel activity-panel">
          <div className="card-title-row">
            <div>
              <p className="eyebrow">Assigned work</p>
              <h2>Your open activities</h2>
            </div>
            <span className="panel-icon" aria-hidden="true">
              <AppIcon name="approvals" size={20} />
            </span>
          </div>
          <div className="stack-list timeline-list">
            {activities.map((activity) => (
              <div key={activity.id}>
                <span className="timeline-dot" aria-hidden="true" />
                <div>
                  <strong>{activity.title}</strong>
                  <span>
                    {activity.due_at
                      ? `Due ${formatTime(activity.due_at)}`
                      : "No due date"}
                  </span>
                </div>
              </div>
            ))}
            {!activities.length ? (
              <div className="empty-state compact">
                <span className="empty-state-icon" aria-hidden="true">
                  <AppIcon name="check" size={20} />
                </span>
                <div>
                  <strong>No open activities</strong>
                  <p>Assigned ERP tasks will appear here.</p>
                </div>
              </div>
            ) : null}
          </div>
        </article>

        <article className="panel governance-panel">
          <div className="card-title-row">
            <div>
              <p className="eyebrow">Recent governance</p>
              <h2>Latest audit events</h2>
            </div>
            <span className="panel-icon" aria-hidden="true">
              <AppIcon name="audit" size={20} />
            </span>
          </div>
          <div className="stack-list audit-list">
            {recentEvents.map((event, index) => (
              <div key={`${event.event_type}-${index}`}>
                <span className="audit-event-icon" aria-hidden="true">
                  <AppIcon name="security" size={16} />
                </span>
                <div>
                  <strong>{event.event_type.replaceAll("_", " ")}</strong>
                  <span>
                    {event.actor_name || "System"} ·{" "}
                    {formatTime(event.created_at)}
                  </span>
                </div>
                <small>{event.entity_type.replaceAll("_", " ")}</small>
              </div>
            ))}
            {!recentEvents.length ? (
              <div className="empty-state compact">
                <span className="empty-state-icon" aria-hidden="true">
                  <AppIcon name="audit" size={20} />
                </span>
                <div>
                  <strong>No events recorded</strong>
                  <p>Security and configuration activity will appear here.</p>
                </div>
              </div>
            ) : null}
          </div>
          <Link className="panel-footer-link" href="/audit-logs">
            View complete audit log <AppIcon name="arrow-right" size={16} />
          </Link>
        </article>
      </section>
    </>
  );
}
