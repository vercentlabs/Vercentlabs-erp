import type { ReactNode } from "react";

import { cn } from "../utils/cn";

// Standalone bulk-selection toolbar for list surfaces that don't route
// through EnterpriseDataGrid's own built-in bulk-actions row (which renders
// the same count+actions shape inline -- see EnterpriseDataGrid.tsx's
// `bulkActions` prop). Kept as a separate exported component so other
// archetypes (board views, non-tabular lists) get the same shared visual
// contract instead of re-deriving it; the grid's inline version is
// pre-existing and not yet refactored to delegate here (tracked debt, see
// docs/ux/UI_REWRITE_TRACKER.md).
export function BulkActionBar({ count, actions, className }: { count: number; actions: ReactNode; className?: string }) {
  if (count === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className={cn(
        "flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--color-action-primary-border)] bg-[var(--color-action-primary-soft)] px-3 py-2",
        className,
      )}
    >
      <span className="text-[length:var(--text-sm)] font-medium text-[var(--color-action-primary)]">
        {count} selected
      </span>
      {actions}
    </div>
  );
}
