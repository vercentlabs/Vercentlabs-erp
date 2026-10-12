"use client";

// The tab bar of a POS workspace whose tabs are separate screens (?tab=): only the tabs the person may open are shown. Showing a tab is not
// security — every screen and API checks its own permission.
import type { PosTab } from "@/features/pos/shared/pos-tabs";
import { RouteTabs } from "@/shared/ui/RouteTabs";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export function PosTabs({ label, base, tabs, current }: { label: string; base: string; tabs: ReadonlyArray<PosTab>; current: string }) {
  const workspace = useWorkspaceContext();
  const owner = workspace.roleSlugs.includes("organization_owner");
  const shown = tabs.filter((tab) => owner || !tab.anyPermission || tab.anyPermission.some((permission) => workspace.permissions.includes(permission)));
  return <RouteTabs label={label} base={base} tabs={shown} current={current} />;
}
