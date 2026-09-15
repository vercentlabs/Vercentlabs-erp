import type { ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "../actions/IconButton.tsx";
import { cn } from "../utilities/cn.ts";

export interface BulkActionBarProps {
  className?: string;
  selectedCount: number;
  onClearSelection: () => void;
  /** Bulk action buttons — each should confirm destructive/irreversible
   * operations via AlertDialog before calling through, same as a
   * single-record action would. */
  actions: ReactNode;
}

/** Replaces ActionBar when one or more rows are selected in an
 * EnterpriseDataGrid. Always shows the exact count and an explicit way to
 * clear selection — never leave the user unsure what a bulk action will
 * affect. */
export function BulkActionBar({ className, selectedCount, onClearSelection, actions }: BulkActionBarProps) {
  if (selectedCount === 0) return null;
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-brand-border bg-brand-soft px-3 py-2",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <IconButton aria-label="Clear selection" size="compact" onPress={onClearSelection}>
          <X className="size-4" aria-hidden="true" />
        </IconButton>
        <span className="text-sm font-medium text-text">
          <span className="tabular-nums">{selectedCount}</span> selected
        </span>
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  );
}
