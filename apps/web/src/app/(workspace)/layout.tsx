import type { ReactNode } from "react";

import { resolveWorkspaceContext } from "@/shell/workspace-context/resolveWorkspaceContext";
import { AppShell } from "@/shell/app-shell/AppShell";

export default async function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const {
    session,
    access,
    accessibleModules,
    pendingApprovalCount,
    unreadNotificationCount,
  } = await resolveWorkspaceContext();
  const trialEndsAt = access.subscription?.trialEndsAt ?? null;

  return (
    <AppShell
      trial={trialEndsAt ? { endsAt: trialEndsAt, ended: Boolean(access.subscription?.trialEnded) } : null}
      workspace={{
        organizationId: session.organizationId,
        organizationName: session.organizationName,
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
        pendingApprovalCount,
        unreadNotificationCount,
      }}
    >
      {children}
    </AppShell>
  );
}
