"use client";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

// UI convenience only -- the server re-checks every permission. Owners and
// system administrators pass, as in the domain's own isOwner().
export function useCan() {
  const workspace = useWorkspaceContext();
  const privileged = workspace.roleSlugs.some((slug) => ["organization_owner", "system_administrator"].includes(slug));
  return (permission?: string) => !permission || privileged || workspace.permissions.includes(permission);
}
