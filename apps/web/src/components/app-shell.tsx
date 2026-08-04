import Link from "next/link";

import AppIcon, { type AppIconName } from "@/components/app-icon";
import Breadcrumbs from "@/components/breadcrumbs";
import ContextSwitcher from "@/components/context-switcher";
import LogoutButton from "@/components/logout-button";
import ModuleContextBar from "@/components/module-context-bar";
import NavigationLink from "@/components/navigation-link";
import NavigationSection, {
  type NavigationSectionItem,
} from "@/components/navigation-section";
import WorkspaceSearch from "@/components/workspace-search";
import type { SessionContext } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";

type NavigationItem = NavigationSectionItem & {
  permission?: string;
};

type NavigationGroup = {
  label: string;
  icon: AppIconName;
  items: NavigationItem[];
};

const workspaceNavigation: NavigationItem[] = [
  { href: "/dashboard", label: "Home", icon: "dashboard", exact: true },
  {
    href: "/master-data",
    label: "Master data",
    icon: "modules",
    permission: PERMISSIONS.businessDataView,
  },
  { href: "/modules", label: "All modules", icon: "modules" },
];

const moduleNavigation: NavigationGroup[] = [
  {
    label: "CRM",
    icon: "crm",
    items: [
      {
        href: "/crm",
        label: "Overview",
        icon: "dashboard",
        exact: true,
        permission: PERMISSIONS.crmView,
      },
      {
        href: "/crm/leads",
        label: "Leads",
        icon: "crm",
        permission: PERMISSIONS.crmView,
      },
      {
        href: "/crm/opportunities",
        label: "Opportunities",
        icon: "sales",
        permission: PERMISSIONS.crmView,
      },
      {
        href: "/crm/activities",
        label: "Activities",
        icon: "approvals",
        permission: PERMISSIONS.crmView,
      },
      {
        href: "/crm/pipeline",
        label: "Pipeline",
        icon: "sales",
        permission: PERMISSIONS.crmView,
      },
      {
        href: "/crm/customer-success",
        label: "Customer success",
        icon: "companies",
        permission: PERMISSIONS.crmView,
      },
      {
        href: "/crm/communications",
        label: "Communications",
        icon: "approvals",
        permission: PERMISSIONS.crmView,
      },
      {
        href: "/crm/conversation-intelligence",
        label: "Conversation intelligence",
        icon: "audit",
        permission: PERMISSIONS.crmView,
      },
      {
        href: "/crm/lead-acquisition",
        label: "Lead acquisition",
        icon: "crm",
        permission: PERMISSIONS.crmView,
      },
      {
        href: "/crm/marketing",
        label: "Marketing",
        icon: "sales",
        permission: PERMISSIONS.crmView,
      },
      {
        href: "/crm/lead-intelligence",
        label: "Lead intelligence",
        icon: "crm",
        permission: PERMISSIONS.crmView,
      },
      {
        href: "/crm/opportunity-revenue",
        label: "Opportunity intelligence",
        icon: "sales",
        permission: PERMISSIONS.crmView,
      },
      {
        href: "/crm/partner-engagement",
        label: "Partner & engagement",
        icon: "sales",
        permission: PERMISSIONS.crmView,
      },
      {
        href: "/crm/reports",
        label: "Reports",
        icon: "audit",
        permission: PERMISSIONS.crmReportsView,
      },
      {
        href: "/crm/settings",
        label: "Settings",
        icon: "settings",
        permission: PERMISSIONS.crmSettingsManage,
      },
    ],
  },
  {
    label: "Sales",
    icon: "sales",
    items: [
      {
        href: "/sales",
        label: "Overview",
        icon: "dashboard",
        exact: true,
        permission: PERMISSIONS.salesView,
      },
      {
        href: "/sales/quotations",
        label: "Quotations",
        icon: "sales",
        permission: PERMISSIONS.salesView,
      },
      {
        href: "/sales/orders",
        label: "Sales orders",
        icon: "sales",
        permission: PERMISSIONS.salesView,
      },
      {
        href: "/sales/reports",
        label: "Reports",
        icon: "audit",
        permission: PERMISSIONS.salesReportsView,
      },
      {
        href: "/sales/settings",
        label: "Settings",
        icon: "settings",
        permission: PERMISSIONS.salesSettingsManage,
      },
    ],
  },
  {
    label: "Procurement",
    icon: "procurement",
    items: [
      {
        href: "/procurement",
        label: "Overview",
        icon: "dashboard",
        exact: true,
        permission: PERMISSIONS.procurementView,
      },
      {
        href: "/procurement/requisitions",
        label: "Requisitions",
        icon: "procurement",
        permission: PERMISSIONS.procurementView,
      },
      {
        href: "/procurement/sourcing",
        label: "Sourcing",
        icon: "procurement",
        permission: PERMISSIONS.procurementView,
      },
      {
        href: "/procurement/suppliers",
        label: "Suppliers",
        icon: "companies",
        permission: PERMISSIONS.procurementSuppliersView,
      },
      {
        href: "/procurement/contracts",
        label: "Agreements",
        icon: "audit",
        permission: PERMISSIONS.procurementView,
      },
      {
        href: "/procurement/orders",
        label: "Purchase orders",
        icon: "procurement",
        permission: PERMISSIONS.procurementView,
      },
      {
        href: "/procurement/receipts",
        label: "Receipts",
        icon: "check",
        permission: PERMISSIONS.procurementView,
      },
      {
        href: "/procurement/matching",
        label: "Matching",
        icon: "approvals",
        permission: PERMISSIONS.procurementView,
      },
      {
        href: "/procurement/reports",
        label: "Reports",
        icon: "audit",
        permission: PERMISSIONS.procurementReportsView,
      },
      {
        href: "/procurement/settings",
        label: "Settings",
        icon: "settings",
        permission: PERMISSIONS.procurementSettingsManage,
      },
    ],
  },
  {
    label: "Accounting",
    icon: "accounting",
    items: [
      {
        href: "/accounting",
        label: "Overview",
        icon: "dashboard",
        exact: true,
        permission: PERMISSIONS.accountingView,
      },
      {
        href: "/accounting/journals",
        label: "Journal entries",
        icon: "accounting",
        permission: PERMISSIONS.accountingView,
      },
      {
        href: "/accounting/receivables",
        label: "Receivables",
        icon: "sales",
        permission: PERMISSIONS.accountingView,
      },
      {
        href: "/accounting/payables",
        label: "Payables",
        icon: "procurement",
        permission: PERMISSIONS.accountingView,
      },
      {
        href: "/accounting/banking",
        label: "Banking",
        icon: "billing",
        permission: PERMISSIONS.accountingView,
      },
      {
        href: "/accounting/assets",
        label: "Fixed assets",
        icon: "assets",
        permission: PERMISSIONS.accountingView,
      },
      {
        href: "/accounting/planning",
        label: "Planning",
        icon: "projects",
        permission: PERMISSIONS.accountingView,
      },
      {
        href: "/accounting/tax",
        label: "Tax",
        icon: "audit",
        permission: PERMISSIONS.accountingView,
      },
      {
        href: "/accounting/operations",
        label: "Operations",
        icon: "settings",
        permission: PERMISSIONS.accountingView,
      },
      {
        href: "/accounting/close",
        label: "Period close",
        icon: "check",
        permission: PERMISSIONS.accountingView,
      },
      {
        href: "/accounting/reports",
        label: "Reports",
        icon: "audit",
        permission: PERMISSIONS.accountingReportsView,
      },
      {
        href: "/accounting/settings",
        label: "Settings",
        icon: "settings",
        permission: PERMISSIONS.accountingSettingsManage,
      },
    ],
  },
];

const workNavigation: NavigationItem[] = [
  { href: "/notifications", label: "Notifications", icon: "notifications" },
  {
    href: "/approvals",
    label: "Approvals",
    icon: "approvals",
    permission: PERMISSIONS.approvalsManage,
  },
];

const governanceNavigation: NavigationItem[] = [
  {
    href: "/billing",
    label: "Billing",
    icon: "billing",
    permission: PERMISSIONS.billingView,
  },
  {
    href: "/audit-logs",
    label: "Audit logs",
    icon: "audit",
    permission: PERMISSIONS.auditView,
  },
];

const settingsNavigation: NavigationItem[] = [
  { href: "/settings", label: "Overview", icon: "dashboard", exact: true },
  {
    href: "/settings/organization",
    label: "Organisation",
    icon: "organisation",
    permission: PERMISSIONS.organizationManage,
  },
  {
    href: "/settings/companies",
    label: "Companies",
    icon: "companies",
    permission: PERMISSIONS.companyManage,
  },
  {
    href: "/settings/branches",
    label: "Branches",
    icon: "branches",
    permission: PERMISSIONS.branchManage,
  },
  {
    href: "/settings/departments",
    label: "Departments",
    icon: "departments",
    permission: PERMISSIONS.departmentManage,
  },
  {
    href: "/settings/teams",
    label: "Teams",
    icon: "teams",
    permission: PERMISSIONS.teamManage,
  },
  {
    href: "/settings/cost-centres",
    label: "Cost centres",
    icon: "cost-centres",
    permission: PERMISSIONS.costCenterManage,
  },
  {
    href: "/settings/users",
    label: "Users",
    icon: "users",
    permission: PERMISSIONS.usersView,
  },
  {
    href: "/settings/roles",
    label: "Roles & permissions",
    icon: "roles",
    permission: PERMISSIONS.rolesManage,
  },
  {
    href: "/settings/numbering-series",
    label: "Numbering series",
    icon: "numbering",
    permission: PERMISSIONS.numberingManage,
  },
  {
    href: "/settings/release-readiness",
    label: "Release readiness",
    icon: "audit",
    permission: PERMISSIONS.auditView,
  },
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function visibleItems(session: SessionContext, items: NavigationItem[]) {
  return items.filter(
    (item) => !item.permission || hasPermission(session, item.permission),
  );
}

function NavigationCollection({
  items,
  unreadNotifications,
  mobile = false,
}: {
  items: NavigationItem[];
  unreadNotifications: number;
  mobile?: boolean;
}) {
  return items.map((item) => (
    <NavigationLink
      badge={item.href === "/notifications" ? unreadNotifications : item.badge}
      exact={item.exact}
      href={item.href}
      icon={item.icon}
      key={item.href}
      label={item.label}
      mobile={mobile}
    />
  ));
}

export default function AppShell({
  session,
  shellData,
  children,
}: {
  session: SessionContext;
  shellData: {
    organizations: Array<{ id: string; name: string }>;
    companies: Array<{ id: string; name: string }>;
    branches: Array<{ id: string; company_id: string; name: string }>;
    unreadNotifications: number;
  };
  children: React.ReactNode;
}) {
  const visibleWorkspace = visibleItems(session, workspaceNavigation);
  const visibleModules = moduleNavigation
    .map((group) => ({ ...group, items: visibleItems(session, group.items) }))
    .filter((group) => group.items.length > 0);
  const visibleWork = visibleItems(session, workNavigation);
  const visibleGovernance = visibleItems(session, governanceNavigation);
  const visibleSettings = visibleItems(session, settingsNavigation);
  const role =
    session.roleSlugs[0]?.replaceAll("_", " ") || session.membershipRole;

  const navigation = (mobile = false) => (
    <>
      <p className="nav-label">Workspace</p>
      <NavigationCollection
        items={visibleWorkspace}
        mobile={mobile}
        unreadNotifications={shellData.unreadNotifications}
      />

      {visibleModules.length ? <p className="nav-label">Modules</p> : null}
      {visibleModules.map((group) => (
        <NavigationSection
          icon={group.icon}
          items={group.items}
          key={group.label}
          label={group.label}
          mobile={mobile}
        />
      ))}

      {visibleWork.length ? <p className="nav-label">My work</p> : null}
      <NavigationCollection
        items={visibleWork}
        mobile={mobile}
        unreadNotifications={shellData.unreadNotifications}
      />

      {visibleGovernance.length ? (
        <p className="nav-label">Governance</p>
      ) : null}
      <NavigationCollection
        items={visibleGovernance}
        mobile={mobile}
        unreadNotifications={shellData.unreadNotifications}
      />

      {visibleSettings.length ? (
        <>
          <p className="nav-label">Administration</p>
          <NavigationSection
            icon="settings"
            items={visibleSettings}
            label="Workspace settings"
            mobile={mobile}
          />
        </>
      ) : null}
    </>
  );

  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#workspace-content">
        Skip to main content
      </a>

      <aside className="sidebar" aria-label="Primary workspace navigation">
        <div className="sidebar-brand-row">
          <Link
            href="/dashboard"
            className="brand-mark inverse"
            aria-label="Vercentlabs ERP dashboard"
          >
            <span className="brand-symbol" aria-hidden="true">
              V
            </span>
            <span className="brand-wordmark">
              <strong>Vercentlabs</strong>
              <small>Enterprise workspace</small>
            </span>
          </Link>
          <span className="environment-badge">Secure</span>
        </div>

        <section
          className="workspace-context"
          aria-label="Current organisation context"
        >
          <div className="workspace-context-heading">
            <span className="workspace-context-icon" aria-hidden="true">
              <AppIcon name="organisation" size={17} />
            </span>
            <div>
              <p>Operating context</p>
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
          </dl>
        </section>

        <nav className="sidebar-navigation">{navigation()}</nav>

        <div className="sidebar-user">
          <Link className="sidebar-profile" href="/profile">
            <span className="avatar small" aria-hidden="true">
              {initials(session.fullName)}
            </span>
            <span>
              <strong>{session.fullName}</strong>
              <small>{role}</small>
            </span>
          </Link>
          <LogoutButton iconOnly />
        </div>
      </aside>

      <div className="workspace-main">
        <header className="topbar">
          <details className="mobile-menu">
            <summary aria-label="Open navigation menu">
              <span aria-hidden="true" className="menu-lines">
                <i />
                <i />
                <i />
              </span>
              <span>Menu</span>
            </summary>
            <div className="mobile-menu-panel">
              <div className="mobile-menu-brand">
                <span className="brand-symbol" aria-hidden="true">
                  V
                </span>
                <div>
                  <strong>Vercentlabs ERP</strong>
                  <small>{session.organizationName}</small>
                </div>
              </div>
              <nav aria-label="Mobile workspace navigation">
                {navigation(true)}
              </nav>
            </div>
          </details>

          <WorkspaceSearch />

          <ContextSwitcher
            key={[
              session.organizationId,
              session.activeCompanyId,
              session.activeBranchId,
            ].join(":")}
            activeOrganizationId={session.organizationId as string}
            activeBranchId={session.activeBranchId}
            activeCompanyId={session.activeCompanyId}
            organizations={shellData.organizations}
            branches={shellData.branches}
            companies={shellData.companies}
          />

          <nav className="topbar-actions" aria-label="Account shortcuts">
            <Link
              className="topbar-icon-button"
              href="/notifications"
              title="Notifications"
              aria-label={`${shellData.unreadNotifications} unread notifications`}
            >
              <AppIcon name="notifications" size={19} />
              {shellData.unreadNotifications ? (
                <span className="topbar-count">
                  {shellData.unreadNotifications > 99
                    ? "99+"
                    : shellData.unreadNotifications}
                </span>
              ) : null}
            </Link>
            <Link
              className="topbar-icon-button topbar-security"
              href="/security"
              title="Security"
              aria-label="Security settings"
            >
              <AppIcon name="security" size={19} />
            </Link>
            <Link
              className="topbar-profile"
              href="/profile"
              aria-label="Open your profile"
            >
              <span className="topbar-avatar" aria-hidden="true">
                {initials(session.fullName)}
              </span>
              <span className="topbar-profile-copy">
                <strong>{session.fullName}</strong>
                <small>{role}</small>
              </span>
            </Link>
          </nav>
        </header>

        <ModuleContextBar
          modules={visibleModules.map((group) => ({
            label: group.label,
            icon: group.icon,
            items: group.items.map(({ href, label, exact }) => ({
              href,
              label,
              exact,
            })),
          }))}
        />
        <div className="breadcrumb-row">
          <Breadcrumbs />
        </div>
        <main
          className="workspace-content"
          id="workspace-content"
          tabIndex={-1}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
