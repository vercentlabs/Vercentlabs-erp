"use client";

import type { ReactNode } from "react";
import { EmptyState } from "@vercentlabs/design-system";

import { useApp } from "@/shell/workspace-context/useApp";

// A page that needs another app (Procurement's Material Demand needs Manufacturing): with that app off, a plain explanation instead of the
// other app's screen — the sidebar hides the page too (registry `requiredApp`), so this only meets an old link or a bookmark.
export function RequiresApp({ app, appName, page, children }: { app: string; appName: string; page: string; children: ReactNode }) {
  const on = useApp(app);
  if (!on) return <EmptyState title={`${page} needs ${appName}`} description={`${page} comes from ${appName}, which is not switched on for your company. An administrator can turn it on in Settings › Modules.`} />;
  return <>{children}</>;
}
