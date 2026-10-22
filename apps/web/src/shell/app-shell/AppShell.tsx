import { Suspense, type ReactNode } from "react";
import type { ModuleAccess } from "@vercentlabs/api";

import { SearchDialogProvider } from "@/features/platform/search/SearchDialog";
import { OpenFormFromAddress } from "@/shell/form-modal/OpenFormFromAddress";
import { SavedNotice } from "@/shell/form-modal/SavedNotice";
import { WelcomeBackNotice } from "@/features/platform/start/WelcomeBackNotice";
import { MobileNav } from "@/shell/primary-sidebar/MobileNav";
import { ModuleRail } from "@/shell/module-sidebar/ModuleRail";
import { QueryProvider } from "@/shell/workspace-context/QueryProvider";
import { TrialBanner, TrialGate, type TrialState } from "./TrialStatus";
import { WorkspaceTopBar } from "./WorkspaceTopBar";
import {
  WorkspaceContextProvider,
  type WorkspaceContextValue,
} from "@/shell/workspace-context/WorkspaceContext";

// Desktop (>=1024px) three-region model: primary icon rail (fixed 64px) + module secondary sidebar
// (240px, only when a module route is active — see SecondarySidebar.tsx)
// + workspace content, with a persistent top strip (breadcrumbs + search,
// company/branch context switcher, settings and the profile menu). Below 1024px the icon rail and secondary
// sidebar are both replaced by MobileNav's top bar + full-label drawer —
// verified at 1440/1024/390px; never squeezed into a phone viewport.
// trial: the company's 30-day Standard trial while it is on one (a bar while it runs; a full-page notice once it has ended).
export function AppShell({
  workspace,
  trial = null,
  modal = null,
  children,
}: {
  workspace: WorkspaceContextValue & {
    accessibleModules: ModuleAccess[];
    pendingApprovalCount: number;
    unreadNotificationCount: number;
  };
  trial?: TrialState;
  /** A create / edit form in a modal over the page (the @modal slot). */
  modal?: ReactNode;
  children: ReactNode;
}) {
  const {
    accessibleModules,
    pendingApprovalCount,
    unreadNotificationCount,
    ...contextValue
  } = workspace;
  const canManageBilling = contextValue.permissions.includes("billing.manage");
  return (
    <QueryProvider>
      <WorkspaceContextProvider value={contextValue}>
        <SearchDialogProvider>
        <div data-app-shell="" className="flex h-dvh w-full flex-col bg-canvas">
          {/* The trial bar spans the whole window, above the rail and the top bar. */}
          <TrialBanner trial={trial} canManageBilling={canManageBilling} />
          <div className="flex min-h-0 w-full flex-1">
          <div className="hidden lg:flex">
            <ModuleRail
              organizationName={contextValue.organizationName}
              accessibleModules={accessibleModules}
              permissions={contextValue.permissions}
              pendingApprovalCount={pendingApprovalCount}
              unreadNotificationCount={unreadNotificationCount}
            />
          </div>
          <div className="relative flex min-w-0 flex-1 flex-col overflow-y-auto">
            <MobileNav
              fullName={contextValue.fullName}
              email={contextValue.email}
              organizationName={contextValue.organizationName}
              accessibleModules={accessibleModules}
              permissions={contextValue.permissions}
              pendingApprovalCount={pendingApprovalCount}
              unreadNotificationCount={unreadNotificationCount}
            />
            <WorkspaceTopBar unreadNotificationCount={unreadNotificationCount} />
            {/* Below lg (phones and tablets) the page ends well above the system navigation bar, so the last row or button is never right on it. */}
            <main className="flex min-w-0 flex-1 flex-col px-6 py-6 md:px-8 max-lg:pb-[calc(3rem+env(safe-area-inset-bottom))]">
              <Suspense fallback={null}><WelcomeBackNotice /></Suspense>
              <TrialGate trial={trial} canManageBilling={canManageBilling}>{children}</TrialGate>
              <Suspense fallback={null}><OpenFormFromAddress /></Suspense>
              {modal}
              <SavedNotice />
            </main>
          </div>
          </div>
        </div>
        </SearchDialogProvider>
      </WorkspaceContextProvider>
    </QueryProvider>
  );
}
