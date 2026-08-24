import BottomNav from "@/core/components/bottom-nav";
import Breadcrumbs from "@/core/components/breadcrumbs";
import CommandPalette from "@/core/components/command-palette";
import ContextSecondarySidebar from "@/core/components/context-secondary-sidebar";
import ContextSwitcher from "@/core/components/context-switcher";
import MobileDrawer from "@/core/components/mobile-drawer";
import MobileWorkspaceNavigation from "@/core/components/mobile-workspace-navigation";
import NotificationsControl from "@/core/components/notifications-control";
import PrimaryNavigationRail from "@/core/components/primary-navigation-rail";
import ProfileMenu from "@/core/components/profile-menu";
import QuickCreateButton from "@/core/components/quick-create-button";
import type { SessionContext } from "@/core/auth";
import type { ResolvedNavigationWithSettings } from "@/core/navigation/resolve-navigation";
import type { QuickCreateAction } from "@/core/quick-create/actions";

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
    session.roleSlugs[0]?.replaceAll("_", " ") ||
    session.membershipRole ||
    "member";

  return (
    <div className="workspace-shell navigation-v2-shell">
      <a className="skip-link" href="#workspace-content">
        Skip to main content
      </a>

      <PrimaryNavigationRail
        navigation={navigation}
        unreadNotifications={shellData.unreadNotifications}
        fullName={session.fullName}
        role={role}
      />

      <ContextSecondarySidebar
        navigation={navigation}
        unreadNotifications={shellData.unreadNotifications}
      />

      <div className="workspace-main">
        <header className="topbar topbar-v3">
          <div className="topbar-v3__identity">
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
              <MobileWorkspaceNavigation
                navigation={navigation}
                unreadNotifications={shellData.unreadNotifications}
              />
            </MobileDrawer>

          </div>

          <div className="topbar-v3__search">
            <CommandPalette
              navigation={navigation}
              quickCreate={quickCreate}
              activeCompanyId={session.activeCompanyId}
              activeBranchId={session.activeBranchId}
            />
          </div>

          <div className="topbar-v3__context">
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
          </div>

          <div className="topbar-v3__actions">
            <QuickCreateButton actions={quickCreate} />
            <nav className="topbar-actions" aria-label="Account shortcuts">
              <NotificationsControl
                initialUnreadCount={shellData.unreadNotifications}
              />
              <ProfileMenu fullName={session.fullName} role={role} />
            </nav>
          </div>
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

      <BottomNav />
    </div>
  );
}
