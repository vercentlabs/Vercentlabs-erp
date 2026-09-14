import type { ReactNode } from "react";

import { resolveWorkspaceContext } from "@/shell/workspace-context/resolveWorkspaceContext";
import { AppShell } from "@/shell/app-shell/AppShell";

export default async function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { session, accessibleModules } = await resolveWorkspaceContext();

  return (
    <AppShell
      workspace={{
        organizationId: session.organizationId,
        organizationName: session.organizationName,
        companyId: session.activeCompanyId,
        companyName: session.companyName,
        branchId: session.activeBranchId,
        branchName: session.branchName,
        userId: session.userId,
        fullName: session.fullName,
        email: session.email,
        locale: session.locale,
        timezone: session.timezone,
        roleSlugs: session.roleSlugs,
        permissions: session.permissions,
        accessibleModuleKeys: accessibleModules
          .filter((m) => m.accessible)
          .map((m) => m.moduleId),
        accessibleModules,
      }}
    >
      {children}
    </AppShell>
  );
}
