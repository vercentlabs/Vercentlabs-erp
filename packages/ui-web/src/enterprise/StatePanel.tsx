import { AlertTriangle, Inbox, Lock, SearchX } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../utils/cn";

// One shared visual shell for every "nothing to show, and here's why"
// surface (SP033: shared UX patterns, not a per-module reinvention).
// EmptyState/NoResultsState/ErrorState/PermissionState are deliberately
// separate exported components (not one component with a `variant` prop
// consumers must remember to set correctly) so a screen author can never
// accidentally render a 403 as a generic empty list.
function StatePanelShell({
  icon,
  title,
  description,
  action,
  tone = "neutral",
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: "neutral" | "danger";
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center gap-3 rounded-[var(--radius-panel)] border border-dashed px-6 py-12 text-center",
        tone === "danger" ? "border-[var(--color-state-danger-soft)] bg-[var(--color-state-danger-soft)]" : "border-[var(--color-border-default)] bg-[var(--color-surface-subtle)]",
      )}
    >
      <span className={cn("flex size-10 items-center justify-center rounded-[var(--radius-pill)]", tone === "danger" ? "bg-[var(--color-state-danger)] text-[var(--color-text-inverse)]" : "bg-[var(--color-canvas-strong)] text-[var(--color-text-muted)]")}>
        {icon}
      </span>
      <div>
        <p className="text-[length:var(--text-md)] font-medium text-[var(--color-text-primary)]">{title}</p>
        {description ? <p className="mt-1 text-[length:var(--text-sm)] text-[var(--color-text-secondary)]">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState(props: { title: string; description?: string; action?: ReactNode }) {
  return <StatePanelShell icon={<Inbox className="size-5" aria-hidden="true" />} {...props} />;
}

export function NoResultsState(props: { title?: string; description?: string; action?: ReactNode }) {
  return (
    <StatePanelShell
      icon={<SearchX className="size-5" aria-hidden="true" />}
      title={props.title || "No results match your filters"}
      description={props.description || "Try a different search term or clear filters to see more records."}
      action={props.action}
    />
  );
}

export function ErrorState(props: { title?: string; description?: string; action?: ReactNode }) {
  return (
    <StatePanelShell
      tone="danger"
      icon={<AlertTriangle className="size-5" aria-hidden="true" />}
      title={props.title || "Something went wrong loading this data"}
      description={props.description}
      action={props.action}
    />
  );
}

export function PermissionState(props: { title?: string; description?: string }) {
  return (
    <StatePanelShell
      icon={<Lock className="size-5" aria-hidden="true" />}
      title={props.title || "You don't have permission to view this"}
      description={props.description || "Ask an administrator to grant access if you believe this is a mistake."}
    />
  );
}
