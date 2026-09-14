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
  children: ReactNode | ((opts: { close: () => void }) => ReactNode);
}

const sizeClasses = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };

/** Standard dialog for forms/details that aren't destructive confirmations
 * — for "are you sure" style prompts, use AlertDialog instead. */
export function Dialog({ className, title, description, hideCloseButton, size = "md", children, ...props }: DialogProps) {
  return (
    <ModalOverlay className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-overlay-backdrop p-4" {...props}>
      <Modal className={cn("w-full", sizeClasses[size])}>
        <AriaDialog
          className={cn(
            "flex max-h-[85vh] flex-col gap-4 rounded-[var(--radius-panel)] border border-border bg-surface-raised p-6 shadow-overlay outline-none",
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
              <div className="flex-1 overflow-auto">{typeof children === "function" ? children(opts) : children}</div>
            </>
          )}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
