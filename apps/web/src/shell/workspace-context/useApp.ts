"use client";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

// Whether an app (module key, e.g. "stock") is on for this workspace and open to this person. A screen hides another app's tabs,
// buttons, fields and warnings when it is off; the server makes the same decision for the work itself (core/access/apps.js).
export function useApp(app: string) {
  return useWorkspaceContext().accessibleModuleKeys.includes(app);
}
