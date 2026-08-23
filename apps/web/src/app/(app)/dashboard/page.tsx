import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";
import Link from "next/link";

import AppIcon, { type AppIconName } from "@/components/app-icon";
import OpenCommandPaletteButton from "@/components/open-command-palette-button";
import WorkItemList from "@/components/work-item-list";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { query } from "@/lib/db";
import { getAccessibleModules } from "@/lib/module-access";
import { getMyWorkSummary } from "@/lib/my-work/aggregate";
import { MODULE_ROUTE_ROOTS } from "@/lib/navigation/route-map";
import type { ModuleId } from "@/lib/navigation/types";

export const metadata = { title: "Home" };

const MODULE_ICONS: Record<ModuleId, AppIconName> = {
  crm: "crm",
  sales: "sales",
  accounting: "accounting",
  procurement: "procurement",
  stock: "stock",
  manufacturing: "manufacturing",
  projects: "projects",
  assets: "assets",
  "point-of-sale": "point-of-sale",
  quality: "quality",
  support: "support",
  "hr-payroll": "hr-payroll",
};

const MODULE_DESCRIPTIONS: Record<ModuleId, string> = {
  crm: "Customers, pipeline, activities and engagement.",
  sales: "Quotations, sales orders and commercial reporting.",
  accounting: "Ledger, receivables, payables, banking, tax and close.",
  procurement: "Requisitions, sourcing, suppliers, purchasing and matching.",
  stock: "Inventory, warehouse movement, traceability and replenishment.",
  manufacturing: "BOMs, work orders, resources and material planning.",
  projects: "Projects, milestones, tasks, time, cost and profitability.",
  assets: "Asset register, assignment, maintenance and financial lifecycle.",
  "point-of-sale": "Checkout, store operations, returns and reconciliation.",
  quality: "Plans, inspections, holds, non-conformance and CAPA.",
  support: "Tickets, queues, service levels, engagement and knowledge.",
  "hr-payroll": "People, attendance, leave, expenses, compensation and payroll.",
};

function formatTime(value: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function DashboardPage() {
  const session = await requireWorkspace();
  const organizationId = session.organizationId as string;

  const [myWork, moduleAccess] = await Promise.all([
    getMyWorkSummary(session, 5),
    getAccessibleModules(session),
  ]);

  const accessibleModules = moduleAccess
    .filter((module) => module.accessible)
    .map((module) => {
      const id = module.moduleId as ModuleId;
      const definition = ERP_MODULE_CATALOG.find((item) => item.key === id);
      return {
        id,
        name: definition?.name ?? module.name,
        description: MODULE_DESCRIPTIONS[id] ?? definition?.description ?? "",
        href: MODULE_ROUTE_ROOTS[id],
        icon: MODULE_ICONS[id],
      };
    });

  const [counts] = await query<{
    companies: number;
    branches: number;
    users: number;
    departments: number;
    roles: number;
    unread_notifications: number;
  }>(
    `
      SELECT
        (SELECT count(*)::int FROM companies WHERE organization_id=$1 AND status='active') AS companies,
        (SELECT count(*)::int FROM branches WHERE organization_id=$1 AND status='active') AS branches,
        (SELECT count(*)::int FROM organization_memberships WHERE organization_id=$1 AND status='active') AS users,
        (SELECT count(*)::int FROM departments WHERE organization_id=$1 AND status='active') AS departments,
        (SELECT count(*)::int FROM roles WHERE organization_id=$1 AND status='active') AS roles,
        (SELECT count(*)::int FROM notifications WHERE organization_id=$1 AND user_id=$2 AND read_at IS NULL) AS unread_notifications
    `,
    [organizationId, session.userId],
  );

  const canViewAudit = hasPermission(session, PERMISSIONS.auditView);
  const recentEvents = canViewAudit
    ? await query<{
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
      )
    : [];

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
    permission?: string;
    attention?: boolean;
  }> = [
    {
      label: "Companies",
      value: counts?.companies || 0,
      description: "Active legal entities",
      icon: "companies",
      href: "/settings/companies",
      permission: PERMISSIONS.companyManage,
    },
    {
      label: "Branches",
      value: counts?.branches || 0,
      description: "Operating locations",
      icon: "branches",
      href: "/settings/branches",
      permission: PERMISSIONS.branchManage,
    },
    {
      label: "Active users",
      value: counts?.users || 0,
      description: "People with workspace access",
      icon: "users",
      href: "/settings/users",
      permission: PERMISSIONS.usersView,
    },
    {
      label: "Departments",
      value: counts?.departments || 0,
      description: "Configured responsibility units",
      icon: "departments",
      href: "/settings/departments",
      permission: PERMISSIONS.departmentManage,
    },
    {
      label: "Unread notifications",
      value: counts?.unread_notifications || 0,
      description: "New workspace updates",
      icon: "notifications",
      href: "/notifications",
      attention: Boolean(counts?.unread_notifications),
    },
    {
      label: "Roles & permissions",
      value: counts?.roles || 0,
      description: "Access roles in use",
      icon: "roles",
      href: "/settings/roles",
      permission: PERMISSIONS.rolesView,
    },
  ];

  const quickActions: Array<{
    href: string;
    label: string;
    description: string;
    icon: AppIconName;
    permission: string;
  }> = [
    {
      href: "/settings/companies",
      label: "Add company",
      description: "Expand the legal entity structure",
      icon: "companies",
      permission: PERMISSIONS.companyManage,
    },
    {
      href: "/settings/branches",
      label: "Add branch",
      description: "Create another operating location",
      icon: "branches",
      permission: PERMISSIONS.branchManage,
    },
    {
      href: "/settings/users",
      label: "Invite user",
      description: "Give a team member controlled access",
      icon: "users",
      permission: PERMISSIONS.usersManage,
    },
    {
      href: "/settings/roles",
      label: "Configure roles",
      description: "Define least-privilege permissions",
      icon: "roles",
      permission: PERMISSIONS.rolesManage,
    },
  ];

  const today = new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return (
    <>
      <section className="erp-home-hero">
        <div className="erp-home-hero__copy">
          <p className="dashboard-date">{today}</p>
          <p className="eyebrow">Operating workspace</p>
          <h1>Welcome back, {session.fullName.split(" ")[0]}.</h1>
          <p className="erp-home-hero__lede">
            Start with what needs attention or move directly into the right
            business area.
          </p>
          <div className="erp-home-hero__actions">
            <OpenCommandPaletteButton />
            <Link className="secondary-button" href="/my-work">
              <AppIcon name="approvals" size={17} />
              Open My work
            </Link>
          </div>
        </div>

        <aside className="erp-home-context" aria-label="Current operating context">
          <div className="erp-home-context__heading">
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
            <div>
              <dt>Modules available</dt>
              <dd>
                {accessibleModules.length} of {ERP_MODULE_CATALOG.length}
              </dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="dashboard-section" aria-labelledby="attention-title">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Attention</p>
            <h2 id="attention-title">What needs you today</h2>
          </div>
          <Link href="/my-work">
            Open My work <AppIcon name="arrow-right" size={16} />
          </Link>
        </div>
        <div className="metric-grid erp-home-attention-grid">
          {[
            {
              label: "Tasks overdue or due today",
              value: myWork.counts.tasksOverdue,
              href: "/tasks",
              icon: "approvals" as const,
            },
            {
              label: "Follow-ups due today",
              value: myWork.counts.followUpsDueToday,
              href: "/follow-ups",
              icon: "notifications" as const,
            },
            {
              label: "Open exceptions",
              value: myWork.counts.exceptionsOpen,
              href: "/exceptions",
              icon: "security" as const,
            },
            {
              label: "Pending approvals",
              value: myWork.counts.approvalsPending,
              href: "/approvals",
              icon: "check" as const,
            },
          ].map((metric) => (
            <Link
              className={`metric-card${metric.value ? " attention" : ""}`}
              href={metric.href}
              key={metric.label}
            >
              <span className="metric-icon" aria-hidden="true">
                <AppIcon name={metric.icon} size={21} />
              </span>
              <span className="metric-copy">
                <small>{metric.label}</small>
                <strong>{metric.value}</strong>
              </span>
              <AppIcon className="metric-arrow" name="arrow-right" size={17} />
            </Link>
          ))}
        </div>
      </section>

      <section
        className="dashboard-section erp-home-modules"
        aria-labelledby="business-areas-title"
      >
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Business areas</p>
            <h2 id="business-areas-title">Move through the ERP by module</h2>
            <p>
              Each module opens its own focused workspace navigation instead of
              exposing hundreds of feature actions at once.
            </p>
          </div>
          <span className="erp-home-module-count">
            {accessibleModules.length} available
          </span>
        </div>

        {accessibleModules.length ? (
          <div className="erp-module-launch-grid">
            {accessibleModules.map((module) => (
              <Link
                className={`erp-module-launch-card module-${module.id}`}
                href={module.href}
                key={module.id}
              >
                <span className="erp-module-launch-card__icon" aria-hidden="true">
                  <AppIcon name={module.icon} size={23} />
                </span>
                <span className="erp-module-launch-card__copy">
                  <strong>{module.name}</strong>
                  <small>{module.description}</small>
                </span>
                <AppIcon
                  className="erp-module-launch-card__arrow"
                  name="arrow-right"
                  size={17}
                />
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <span className="empty-state-icon" aria-hidden="true">
              <AppIcon name="modules" size={21} />
            </span>
            <div>
              <strong>No business modules are available</strong>
              <p>
                Module visibility follows your workspace enablement,
                subscription and role permissions.
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="dashboard-section" aria-labelledby="overview-title">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Workspace foundation</p>
            <h2 id="overview-title">Organisation overview</h2>
          </div>
          {canViewAudit ? (
            <Link href="/audit-logs">
              Review governance <AppIcon name="arrow-right" size={16} />
            </Link>
          ) : null}
        </div>
        <div className="metric-grid">
          {metrics
            .filter(
              (metric) =>
                !metric.permission || hasPermission(session, metric.permission),
            )
            .map((metric) => (
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
                <AppIcon
                  className="metric-arrow"
                  name="arrow-right"
                  size={17}
                />
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
            <p className="eyebrow">Workspace administration</p>
            <h2 id="quick-actions-title">Keep the foundation current</h2>
          </div>
        </div>
        <div className="quick-actions">
          {quickActions
            .filter((action) => hasPermission(session, action.permission))
            .map((action) => (
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

      <section className="content-grid dashboard-panels erp-home-operations">
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

        {canViewAudit ? (
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
        ) : null}
      </section>
    </>
  );
}
