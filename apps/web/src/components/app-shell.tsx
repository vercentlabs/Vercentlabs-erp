import Link from "next/link";

import AppIcon, { type AppIconName } from "@/components/app-icon";
import Breadcrumbs from "@/components/breadcrumbs";
import ContextSwitcher from "@/components/context-switcher";
import LogoutButton from "@/components/logout-button";
import NavigationLink from "@/components/navigation-link";
import type { SessionContext } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";

type NavigationItem = {
  href: string;
  label: string;
  icon: AppIconName;
  permission?: string;
};

const primaryNavigation: NavigationItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  {
    href: "/procurement",
    label: "Procurement overview",
    icon: "procurement",
    permission: PERMISSIONS.procurementView,
  },
  {
    href: "/accounting",
    label: "Accounting overview",
    icon: "accounting",
    permission: PERMISSIONS.accountingView,
  },
  {
    href: "/sales",
    label: "Sales overview",
    icon: "sales",
    permission: PERMISSIONS.salesView,
  },
  {
    href: "/crm",
    label: "CRM overview",
    icon: "crm",
    permission: PERMISSIONS.crmView,
  },
  {
    href: "/master-data",
    label: "Master data",
    icon: "modules",
    permission: PERMISSIONS.businessDataView,
  },
  { href: "/modules", label: "Modules", icon: "modules" },
  { href: "/notifications", label: "Notifications", icon: "notifications" },
  {
    href: "/approvals",
    label: "Approvals",
    icon: "approvals",
    permission: PERMISSIONS.approvalsManage,
  },
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


const procurementNavigation: NavigationItem[] = [
  { href: "/procurement/requisitions", label: "Requisitions", icon: "procurement", permission: PERMISSIONS.procurementView },
  { href: "/procurement/sourcing", label: "Sourcing", icon: "procurement", permission: PERMISSIONS.procurementView },
  { href: "/procurement/suppliers", label: "Suppliers", icon: "procurement", permission: PERMISSIONS.procurementSuppliersView },
  { href: "/procurement/contracts", label: "Agreements", icon: "procurement", permission: PERMISSIONS.procurementView },
  { href: "/procurement/orders", label: "Purchase orders", icon: "procurement", permission: PERMISSIONS.procurementView },
  { href: "/procurement/receipts", label: "Receipts", icon: "procurement", permission: PERMISSIONS.procurementView },
  { href: "/procurement/matching", label: "Matching", icon: "procurement", permission: PERMISSIONS.procurementView },
  { href: "/procurement/reports", label: "Reports", icon: "procurement", permission: PERMISSIONS.procurementReportsView },
  { href: "/procurement/settings", label: "Settings", icon: "procurement", permission: PERMISSIONS.procurementSettingsManage },
];

const accountingNavigation: NavigationItem[] = [
  { href: "/accounting/journals", label: "Journal entries", icon: "accounting", permission: PERMISSIONS.accountingView },
  { href: "/accounting/receivables", label: "Receivables", icon: "accounting", permission: PERMISSIONS.accountingView },
  { href: "/accounting/payables", label: "Payables", icon: "accounting", permission: PERMISSIONS.accountingView },
  { href: "/accounting/banking", label: "Banking", icon: "accounting", permission: PERMISSIONS.accountingView },
  { href: "/accounting/assets", label: "Fixed assets", icon: "accounting", permission: PERMISSIONS.accountingView },
  { href: "/accounting/planning", label: "Planning & automation", icon: "accounting", permission: PERMISSIONS.accountingView },
  { href: "/accounting/tax", label: "Tax", icon: "accounting", permission: PERMISSIONS.accountingView },
  { href: "/accounting/operations", label: "Advanced operations", icon: "accounting", permission: PERMISSIONS.accountingView },
  { href: "/accounting/close", label: "Period close", icon: "accounting", permission: PERMISSIONS.accountingView },
  { href: "/accounting/reports", label: "Financial reports", icon: "accounting", permission: PERMISSIONS.accountingReportsView },
  { href: "/accounting/settings", label: "Accounting settings", icon: "accounting", permission: PERMISSIONS.accountingSettingsManage },
];

const salesNavigation: NavigationItem[] = [
  { href: "/sales/quotations", label: "Quotations", icon: "sales", permission: PERMISSIONS.salesView },
  { href: "/sales/orders", label: "Sales orders", icon: "sales", permission: PERMISSIONS.salesView },
  { href: "/sales/reports", label: "Sales reports", icon: "sales", permission: PERMISSIONS.salesReportsView },
  { href: "/sales/settings", label: "Sales settings", icon: "sales", permission: PERMISSIONS.salesSettingsManage },
];

const crmNavigation: NavigationItem[] = [
  {
    href: "/crm/leads",
    label: "Leads",
    icon: "crm",
    permission: PERMISSIONS.crmView,
  },
  {
    href: "/crm/opportunities",
    label: "Opportunities",
    icon: "crm",
    permission: PERMISSIONS.crmView,
  },
  {
    href: "/crm/activities",
    label: "Activities",
    icon: "crm",
    permission: PERMISSIONS.crmView,
  },
  {
    href: "/crm/pipeline",
    label: "Pipeline",
    icon: "crm",
    permission: PERMISSIONS.crmView,
  },
  {
    href: "/crm/reports",
    label: "Reports",
    icon: "crm",
    permission: PERMISSIONS.crmReportsView,
  },
  {
    href: "/crm/settings",
    label: "CRM settings",
    icon: "crm",
    permission: PERMISSIONS.crmSettingsManage,
  },
];

const settingsNavigation: NavigationItem[] = [
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
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
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
  const visiblePrimary = primaryNavigation.filter(
    (item) => !item.permission || hasPermission(session, item.permission),
  );
  const visibleProcurement = procurementNavigation.filter(
    (item) => !item.permission || hasPermission(session, item.permission),
  );
  const visibleAccounting = accountingNavigation.filter(
    (item) => !item.permission || hasPermission(session, item.permission),
  );
  const visibleSales = salesNavigation.filter(
    (item) => !item.permission || hasPermission(session, item.permission),
  );
  const visibleCrm = crmNavigation.filter(
    (item) => !item.permission || hasPermission(session, item.permission),
  );
  const visibleSettings = settingsNavigation.filter(
    (item) => !item.permission || hasPermission(session, item.permission),
  );
  const role =
    session.roleSlugs[0]?.replaceAll("_", " ") || session.membershipRole;

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
              <small>ERP workspace</small>
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
              <AppIcon name="organisation" size={18} />
            </span>
            <div>
              <p>Organisation</p>
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

        <nav className="sidebar-navigation">
          <p className="nav-label">Workspace</p>
          {visiblePrimary.map((item) => (
            <NavigationLink
              badge={
                item.href === "/notifications"
                  ? shellData.unreadNotifications
                  : undefined
              }
              href={item.href}
              icon={item.icon}
              key={item.href}
              label={item.label}
            />
          ))}

          {visibleProcurement.length ? (
            <>
              <p className="nav-label">Procurement</p>
              {visibleProcurement.map((item) => (
                <NavigationLink href={item.href} icon={item.icon} key={item.href} label={item.label} />
              ))}
            </>
          ) : null}

          {visibleAccounting.length ? (
            <>
              <p className="nav-label">Accounting</p>
              {visibleAccounting.map((item) => (
                <NavigationLink href={item.href} icon={item.icon} key={item.href} label={item.label} />
              ))}
            </>
          ) : null}

          {visibleSales.length ? (
            <>
              <p className="nav-label">Sales</p>
              {visibleSales.map((item) => (
                <NavigationLink href={item.href} icon={item.icon} key={item.href} label={item.label} />
              ))}
            </>
          ) : null}

          {visibleCrm.length ? (
            <>
              <p className="nav-label">CRM</p>
              {visibleCrm.map((item) => (
                <NavigationLink
                  href={item.href}
                  icon={item.icon}
                  key={item.href}
                  label={item.label}
                />
              ))}
            </>
          ) : null}

          {visibleSettings.length ? (
            <>
              <p className="nav-label">Administration</p>
              {visibleSettings.map((item) => (
                <NavigationLink
                  href={item.href}
                  icon={item.icon}
                  key={item.href}
                  label={item.label}
                />
              ))}
            </>
          ) : null}
        </nav>

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
              <p className="nav-label">Workspace</p>
              {visiblePrimary.map((item) => (
                <NavigationLink
                  badge={
                    item.href === "/notifications"
                      ? shellData.unreadNotifications
                      : undefined
                  }
                  href={item.href}
                  icon={item.icon}
                  key={item.href}
                  label={item.label}
                  mobile
                />
              ))}
              {visibleProcurement.length ? (
                <>
                  <p className="nav-label">Procurement</p>
                  {visibleProcurement.map((item) => (
                    <NavigationLink href={item.href} icon={item.icon} key={item.href} label={item.label} mobile />
                  ))}
                </>
              ) : null}
              {visibleAccounting.length ? (
                <>
                  <p className="nav-label">Accounting</p>
                  {visibleAccounting.map((item) => (
                    <NavigationLink href={item.href} icon={item.icon} key={item.href} label={item.label} mobile />
                  ))}
                </>
              ) : null}
              {visibleSales.length ? (
                <>
                  <p className="nav-label">Sales</p>
                  {visibleSales.map((item) => (
                    <NavigationLink href={item.href} icon={item.icon} key={item.href} label={item.label} mobile />
                  ))}
                </>
              ) : null}
              {visibleCrm.length ? (
                <>
                  <p className="nav-label">CRM</p>
                  {visibleCrm.map((item) => (
                    <NavigationLink
                      href={item.href}
                      icon={item.icon}
                      key={item.href}
                      label={item.label}
                      mobile
                    />
                  ))}
                </>
              ) : null}
              {visibleSettings.length ? (
                <>
                  <p className="nav-label">Administration</p>
                  {visibleSettings.map((item) => (
                    <NavigationLink
                      href={item.href}
                      icon={item.icon}
                      key={item.href}
                      label={item.label}
                      mobile
                    />
                  ))}
                </>
              ) : null}
            </div>
          </details>

          <form action="/search" className="global-search" role="search">
            <label className="sr-only" htmlFor="global-search">
              Search workspace
            </label>
            <span className="global-search-icon" aria-hidden="true">
              <AppIcon name="search" size={19} />
            </span>
            <input
              autoComplete="off"
              id="global-search"
              name="q"
              placeholder="Search partners, items, companies, branches or users"
              type="search"
            />
            <span className="search-scope" aria-hidden="true">
              Workspace
            </span>
          </form>

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
              <AppIcon name="notifications" size={20} />
              {shellData.unreadNotifications ? (
                <span className="topbar-count">
                  {shellData.unreadNotifications > 99
                    ? "99+"
                    : shellData.unreadNotifications}
                </span>
              ) : null}
            </Link>
            <Link
              className="topbar-icon-button"
              href="/security"
              title="Security"
              aria-label="Security settings"
            >
              <AppIcon name="security" size={20} />
            </Link>
            <Link
              className="topbar-avatar"
              href="/profile"
              aria-label="Open your profile"
            >
              {initials(session.fullName)}
            </Link>
          </nav>
        </header>

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
