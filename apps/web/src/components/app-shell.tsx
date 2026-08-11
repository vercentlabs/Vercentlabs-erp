import Link from "next/link";

import AppIcon from "@/components/app-icon";
import BottomNav from "@/components/bottom-nav";
import Breadcrumbs from "@/components/breadcrumbs";
import CommandPalette from "@/components/command-palette";
import ContextSwitcher from "@/components/context-switcher";
import LogoutButton from "@/components/logout-button";
import MobileDrawer from "@/components/mobile-drawer";
import ModuleContextBar from "@/components/module-context-bar";
import NavigationLink from "@/components/navigation-link";
import NavigationSection from "@/components/navigation-section";
import NotificationsControl from "@/components/notifications-control";
import ProfileMenu from "@/components/profile-menu";
import QuickCreateButton from "@/components/quick-create-button";
import SidebarModules from "@/components/sidebar-modules";
import SidebarShell from "@/components/sidebar-shell";
import type { SessionContext } from "@/lib/auth";
import type { ResolvedNavigationWithSettings } from "@/lib/navigation/resolve-navigation";
import type { NavigationItem } from "@/lib/navigation/types";
import type { QuickCreateAction } from "@/lib/quick-create/actions";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
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

// AppShell no longer computes navigation visibility itself — the `navigation`
// prop arrives already server-resolved (Part 9: "filter before render") from
// resolveNavigation() in apps/web/src/app/(app)/layout.tsx, which composes
// Prompt 4/5's canonical module-access resolver with the existing
// permission checks. See docs/implementation/ERP_NAVIGATION_FOUNDATION_006.md.
export default function AppShell({
  session,
  shellData,
  navigation,
  quickCreate,
  children,
}: {
  session: SessionContext;
  shellData: {
    organizations: Array<{ id: string; name: string }>;
    companies: Array<{ id: string; name: string }>;
    branches: Array<{ id: string; company_id: string; name: string }>;
    unreadNotifications: number;
  };
  navigation: ResolvedNavigationWithSettings;
  quickCreate: QuickCreateAction[];
  children: React.ReactNode;
}) {
  const role =
    session.roleSlugs[0]?.replaceAll("_", " ") || session.membershipRole;

  const navigationTree = (mobile = false) => (
    <>
      <p className="nav-label">Workspace</p>
      <NavigationCollection
        items={navigation.workspace}
        mobile={mobile}
        unreadNotifications={shellData.unreadNotifications}
      />

      {navigation.modules.length ? <p className="nav-label">Modules</p> : null}
      <SidebarModules groups={navigation.modules} mobile={mobile} />

      {navigation.myWork.length ? <p className="nav-label">My work</p> : null}
      <NavigationCollection
        items={navigation.myWork}
        mobile={mobile}
        unreadNotifications={shellData.unreadNotifications}
      />

      {navigation.governance.length ? (
        <p className="nav-label">Governance</p>
      ) : null}
      <NavigationCollection
        items={navigation.governance}
        mobile={mobile}
        unreadNotifications={shellData.unreadNotifications}
      />

      {navigation.administration.length || navigation.workspaceSettings.items.length ? (
        <>
          <p className="nav-label">Administration</p>
          <NavigationCollection
            items={navigation.administration}
            mobile={mobile}
            unreadNotifications={shellData.unreadNotifications}
          />
          {navigation.workspaceSettings.items.length ? (
            <NavigationSection
              icon="settings"
              items={navigation.workspaceSettings.items}
              label={navigation.workspaceSettings.label}
              mobile={mobile}
            />
          ) : null}
        </>
      ) : null}
    </>
  );

  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#workspace-content">
        Skip to main content
      </a>

      <SidebarShell>
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

        <nav className="sidebar-navigation" aria-label="Primary navigation">
          {navigationTree()}
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
      </SidebarShell>

      <div className="workspace-main">
        <header className="topbar">
          <MobileDrawer
            brand={
              <div className="mobile-menu-brand">
                <span className="brand-symbol" aria-hidden="true">
                  V
                </span>
                <div>
                  <strong>Vercentlabs ERP</strong>
                  <small>{session.organizationName}</small>
                </div>
              </div>
            }
          >
            {navigationTree(true)}
          </MobileDrawer>

          <CommandPalette
            navigation={navigation}
            quickCreate={quickCreate}
            activeCompanyId={session.activeCompanyId}
            activeBranchId={session.activeBranchId}
          />

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

          <QuickCreateButton actions={quickCreate} />

          <nav className="topbar-actions" aria-label="Account shortcuts">
            <NotificationsControl initialUnreadCount={shellData.unreadNotifications} />
            <ProfileMenu fullName={session.fullName} role={role} />
          </nav>
        </header>

        <ModuleContextBar
          modules={navigation.modules.map((group) => ({
            label: group.label,
            icon: group.icon,
            items: group.items.map(
              ({ href, label, exact, activePrefixes }) => ({
                href,
                label,
                exact,
                activePrefixes,
              }),
            ),
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

      <BottomNav />
    </div>
  );
}
