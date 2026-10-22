import type { ReactNode } from "react";
import {
  Modal,
  ModalOverlay,
  Dialog as AriaDialog,
  Heading,
  type ModalOverlayProps,
} from "react-aria-components";
import { X } from "lucide-react";
import { IconButton } from "../actions/IconButton.tsx";
import { cn } from "../utilities/cn.ts";

export interface DialogProps extends Omit<ModalOverlayProps, "className" | "children"> {
  className?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Hide the built-in close (X) button — e.g. for a wizard step where
   * "Escape"/backdrop-click should still close but no icon-button should
   * be shown. Keyboard/backdrop dismissal is controlled separately via
   * `isDismissable`/`isKeyboardDismissDisabled`. */
  hideCloseButton?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  /** The dialog's actions (Cancel · Save), kept in view below the scrolling body instead of at the end of it. On a phone the
   * buttons share the width equally. */
  footer?: ReactNode;
  children: ReactNode | ((opts: { close: () => void }) => ReactNode);
}

const sizeClasses = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };

/** Standard dialog for forms/details that aren't destructive confirmations
 * — for "are you sure" style prompts, use AlertDialog instead. On a phone it
 * rises from the bottom edge as a sheet; from sm up it is centred. The body
 * scrolls with its scrollbar at the dialog's edge, never over the fields. */
export function Dialog({ className, title, description, hideCloseButton, size = "md", footer, children, ...props }: DialogProps) {
  return (
    <ModalOverlay className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-overlay-backdrop sm:items-center sm:p-4" {...props}>
      <Modal className={cn("w-full", sizeClasses[size])}>
        <AriaDialog
          className={cn(
            "flex max-h-[92dvh] flex-col gap-4 rounded-t-[var(--radius-panel)] border-t border-border bg-surface-raised p-5 shadow-overlay outline-none",
            "sm:max-h-[85vh] sm:rounded-[var(--radius-panel)] sm:border sm:p-6",
            className,
          )}
        >
          {(opts) => (
            <>
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <Heading slot="title" className="text-section font-semibold text-text">
                    {title}
                  </Heading>
                  {description && <p className="text-sm text-text-secondary">{description}</p>}
                </div>
                {!hideCloseButton && (
                  <IconButton aria-label="Close dialog" size="compact" onPress={opts.close}>
                    <X className="size-4" aria-hidden="true" />
                  </IconButton>
                )}
              </div>
              <div className="-mx-5 min-h-0 flex-1 overflow-auto px-5 sm:-mx-6 sm:px-6">{typeof children === "function" ? children(opts) : children}</div>
              {footer && (
                <div className="-mx-5 -mb-5 flex justify-end gap-2 border-t border-border px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:[&>*]:flex-1 sm:-mx-6 sm:-mb-6 sm:px-6 sm:py-4">
                  {footer}
                </div>
              )}
            </>
          )}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
