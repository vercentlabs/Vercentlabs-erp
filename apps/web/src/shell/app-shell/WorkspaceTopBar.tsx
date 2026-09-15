"use client";

import { Breadcrumbs } from "@/shell/navigation/Breadcrumbs";
import { ContextSwitcher } from "@/shell/workspace-context/ContextSwitcher";

// Persistent strip above every workspace page (desktop and mobile) —
// breadcrumbs (Phase 19) on the left, company/branch context switcher
// (Phase 4) on the right. One place for both rather than each page
// building its own header.
export function WorkspaceTopBar() {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-surface px-4">
      <Breadcrumbs />
      <ContextSwitcher />
    </div>
  );
}
