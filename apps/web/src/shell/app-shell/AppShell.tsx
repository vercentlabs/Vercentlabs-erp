import type { ReactNode } from "react";
import type { ModuleAccess } from "@vercentlabs/api";

import { MobileNav } from "@/shell/primary-sidebar/MobileNav";
import { ModuleRail } from "@/shell/module-sidebar/ModuleRail";
import { QueryProvider } from "@/shell/workspace-context/QueryProvider";
import { WorkspaceTopBar } from "./WorkspaceTopBar";
import {
  WorkspaceContextProvider,
  type WorkspaceContextValue,
} from "@/shell/workspace-context/WorkspaceContext";

// Desktop (>=1024px) three-region model per Prompt 2 Phase 6, closed out in
// Prompt 2B: primary icon rail (fixed 64px) + module secondary sidebar
// (240px, only when a module route is active — see SecondarySidebar.tsx)
// + workspace content, with a persistent top strip (breadcrumbs + search,
// company/branch context switcher, settings and the profile menu). Below 1024px the icon rail and secondary
// sidebar are both replaced by MobileNav's top bar + full-label drawer —
// verified at 1440/1024/390px; never squeezed into a phone viewport.
export function AppShell({
  workspace,
  children,
}: {
  workspace: WorkspaceContextValue & {
    accessibleModules: ModuleAccess[];
    pendingApprovalCount: number;
    unreadNotificationCount: number;
  };
  children: ReactNode;
}) {
  const {
    accessibleModules,
    pendingApprovalCount,
    unreadNotificationCount,
    ...contextValue
  } = workspace;
  return (
    <QueryProvider>
      <WorkspaceContextProvider value={contextValue}>
        <div className="flex h-dvh w-full bg-canvas">
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
              organizationName={contextValue.organizationName}
              accessibleModules={accessibleModules}
              permissions={contextValue.permissions}
              pendingApprovalCount={pendingApprovalCount}
              unreadNotificationCount={unreadNotificationCount}
            />
            <WorkspaceTopBar />
            <main className="flex min-w-0 flex-1 flex-col px-6 py-6 md:px-8">{children}</main>
          </div>
        </div>
      </WorkspaceContextProvider>
    </QueryProvider>
  );
}
