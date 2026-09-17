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

export interface DrawerProps extends Omit<ModalOverlayProps, "className" | "children"> {
  className?: string;
  title: ReactNode;
  side?: "right" | "left";
  size?: "sm" | "md" | "lg";
  children: ReactNode | ((opts: { close: () => void }) => ReactNode);
}

const sizeClasses = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" };

/**
 * Edge-anchored panel — for a quick-view/side workspace (a record preview,
 * a filter builder) that shouldn't fully interrupt the underlying page the
 * way a centered Dialog does. Use Dialog for forms/confirmations instead.
 */
export function Drawer({ className, title, side = "right", size = "md", children, ...props }: DrawerProps) {
  return (
    <ModalOverlay
      className={cn("fixed inset-0 z-[var(--z-modal)] flex bg-overlay-backdrop", side === "right" ? "justify-end" : "justify-start")}
      {...props}
    >
      <Modal className={cn("h-full w-full", sizeClasses[size])}>
        <AriaDialog
          className={cn(
            "flex h-full flex-col gap-4 border-border bg-surface-raised p-6 shadow-overlay outline-none",
            side === "right" ? "border-l" : "border-r",
            className,
          )}
        >
          {(opts) => (
            <>
              <div className="flex items-start justify-between gap-4">
                <Heading slot="title" className="text-section font-semibold text-text">
                  {title}
                </Heading>
                <IconButton aria-label="Close" size="compact" onPress={opts.close}>
                  <X className="size-4" aria-hidden="true" />
                </IconButton>
              </div>
              <div className="flex-1 overflow-auto">{typeof children === "function" ? children(opts) : children}</div>
            </>
          )}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}

export { Drawer as Sheet, type DrawerProps as SheetProps };
