import { Dialog as BaseDialog } from "@base-ui-components/react/dialog";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "../utils/cn";

// Base UI owns focus trapping, inert-background, Escape-to-close,
// return-focus-on-close and the required aria-modal/aria-labelledby/
// aria-describedby wiring here -- exactly the class of primitive
// docs/01-standards/ACCESSIBILITY_STANDARD.md requires and that is easy to
// get subtly wrong hand-rolling it per module (this repo's own legacy
// apps/web/src/shared/design/dialog.module.css is exactly that hand-rolled
// pattern, kept until every dialog usage migrates). This wraps Base UI's
// parts with the ERP's own visual language rather than exposing Base UI's
// unstyled parts directly to module code.
export const DialogRoot = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogClose = BaseDialog.Close;

export function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: ComponentProps<typeof BaseDialog.Popup> & { showCloseButton?: boolean }) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 z-[var(--z-modal)] bg-[var(--erp-color-overlay-backdrop)] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity" />
      <BaseDialog.Popup
        className={cn(
          "fixed left-1/2 top-1/2 z-[var(--z-modal)] w-full max-w-lg -translate-x-1/2 -translate-y-1/2",
          "rounded-[var(--radius-panel)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-overlay)]",
          "data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:scale-95 transition-all",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <BaseDialog.Close
            aria-label="Close dialog"
            className="absolute right-4 top-4 rounded-[var(--radius-control)] p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-canvas-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
          >
            <X className="size-4" aria-hidden="true" />
          </BaseDialog.Close>
        ) : null}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof BaseDialog.Title>) {
  return <BaseDialog.Title className={cn("text-[length:var(--text-xl)] font-semibold text-[var(--color-text-primary)]", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof BaseDialog.Description>) {
  return <BaseDialog.Description className={cn("mt-1 text-[length:var(--text-sm)] text-[var(--color-text-secondary)]", className)} {...props} />;
}

export function DialogFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mt-6 flex justify-end gap-3", className)}>{children}</div>;
}
