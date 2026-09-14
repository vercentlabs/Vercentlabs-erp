import { AlertDialog as BaseAlertDialog } from "@base-ui-components/react/alert-dialog";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "../utils/cn";

// For destructive/irreversible actions (archive, disqualify, merge, bulk
// delete -- see docs/ux/UI_REWRITE_TRACKER.md's "no decorative action
// buttons" rule): unlike DialogContent, no default close (X) button, and
// Escape/outside-press are disabled by default via Base UI's AlertDialog
// semantics -- the caller must click an explicit Cancel/Confirm action, per
// SP032's requirement that destructive confirmations aren't dismissible by
// accident.
export const AlertDialogRoot = BaseAlertDialog.Root;
export const AlertDialogTrigger = BaseAlertDialog.Trigger;
export const AlertDialogClose = BaseAlertDialog.Close;

export function AlertDialogContent({ className, ...props }: ComponentProps<typeof BaseAlertDialog.Popup>) {
  return (
    <BaseAlertDialog.Portal>
      <BaseAlertDialog.Backdrop className="fixed inset-0 z-[var(--z-modal)] bg-[var(--erp-color-overlay-backdrop)] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity" />
      <BaseAlertDialog.Popup
        aria-modal="true"
        className={cn(
          "fixed left-1/2 top-1/2 z-[var(--z-modal)] w-full max-w-md -translate-x-1/2 -translate-y-1/2",
          "rounded-[var(--radius-panel)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-overlay)]",
          "data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:scale-95 transition-all",
          className,
        )}
        {...props}
      />
    </BaseAlertDialog.Portal>
  );
}

export function AlertDialogTitle({ className, ...props }: ComponentProps<typeof BaseAlertDialog.Title>) {
  return <BaseAlertDialog.Title className={cn("text-[length:var(--text-xl)] font-semibold text-[var(--color-text-primary)]", className)} {...props} />;
}

export function AlertDialogDescription({ className, ...props }: ComponentProps<typeof BaseAlertDialog.Description>) {
  return <BaseAlertDialog.Description className={cn("mt-1 text-[length:var(--text-sm)] text-[var(--color-text-secondary)]", className)} {...props} />;
}

export function AlertDialogFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mt-6 flex justify-end gap-3", className)}>{children}</div>;
}
