"use client";

import type { ReactNode } from "react";
import { SectionHeader, cn, surfaceVariants } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

// Presentation helpers composed from design-system primitives; local so modules do not depend on
// each other's feature folders.
export function ProjectsPanel({ title, description, actions, children, className }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn(surfaceVariants({ padding: "md" }), "flex flex-col gap-3", className)}>
      {(title || actions) && <SectionHeader title={title} description={description} actions={actions} />}
      {children}
    </section>
  );
}

const tones = {
  danger: "border-danger-emphasis/30 bg-danger-soft text-danger",
  warning: "border-warning-emphasis/30 bg-warning-soft text-warning",
  success: "border-success-emphasis/30 bg-success-soft text-success",
  info: "border-info-emphasis/30 bg-info-soft text-info",
} as const;

export function ProjectsAlert({ tone = "danger", children, className }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-[var(--radius-control)] border px-3 py-2 text-sm", tones[tone], className)}>
      {children}
    </div>
  );
}

// UI convenience only -- the server re-checks every permission. Owners and system administrators pass.
export function useCan() {
  const workspace = useWorkspaceContext();
  const privileged = workspace.roleSlugs.some((slug) => ["organization_owner", "system_administrator"].includes(slug));
  return (permission?: string) => !permission || privileged || workspace.permissions.includes(permission);
}
