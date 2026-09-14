import type { ReactNode } from "react";
import type { ModuleAccess } from "@vercentlabs/api";

import { PrimarySidebar } from "@/shell/primary-sidebar/PrimarySidebar";
import { MobileNav } from "@/shell/primary-sidebar/MobileNav";
import {
  WorkspaceContextProvider,
  type WorkspaceContextValue,
} from "@/shell/workspace-context/WorkspaceContext";

// Desktop (>=1024px) three-region model per Prompt 2 Phase 6: primary icon
// rail (fixed 64px) + workspace content. Below 1024px the icon rail is
// replaced by MobileNav's top bar + full-label drawer — verified at
// 1440/1024/390px; the rail is never squeezed into a phone viewport (see
// MobileNav.tsx). The secondary (module) sidebar region is intentionally
// not built yet — none of the 12 modules has real secondary navigation to
// show this prompt (see moduleNavigationRegistry.ts's header comment);
// adding an empty secondary rail would just be decorative chrome.
export function AppShell({
  workspace,
  children,
}: {
  workspace: WorkspaceContextValue & { accessibleModules: ModuleAccess[] };
  children: ReactNode;
}) {
  const { accessibleModules, ...contextValue } = workspace;
  return (
    <WorkspaceContextProvider value={contextValue}>
      <div className="flex h-dvh w-full bg-canvas">
        <div className="hidden lg:flex">
          <PrimarySidebar
            organizationName={contextValue.organizationName}
            fullName={contextValue.fullName}
            email={contextValue.email}
            accessibleModules={accessibleModules}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <MobileNav
            organizationName={contextValue.organizationName}
            accessibleModules={accessibleModules}
          />
          <main className="flex min-w-0 flex-1 flex-col">{children}</main>
        </div>
      </div>
    </WorkspaceContextProvider>
  );
}
