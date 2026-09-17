import type { ReactNode } from "react";
import {
  Modal,
  ModalOverlay,
  Dialog as AriaDialog,
  Heading,
  type ModalOverlayProps,
} from "react-aria-components";
import { AlertTriangle } from "lucide-react";
import { Button } from "../actions/Button.tsx";
import { cn } from "../utilities/cn.ts";

export interface AlertDialogProps extends Omit<ModalOverlayProps, "className" | "children"> {
  title: ReactNode;
  /** The consequence of the action, stated plainly — this is the one place
   * in the product where vague copy is not acceptable. */
  description: ReactNode;
  /** Defaults to "danger" — pass "primary" only for a non-destructive
   * confirmation (e.g. confirming a large but reversible bulk update). */
  tone?: "danger" | "primary";
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  isConfirming?: boolean;
}

/**
 * Confirmation for destructive/irreversible/financial actions. Per the ERP
 * error-prevention principle, this is deliberately heavier than Dialog —
 * it always states the consequence and requires an explicit confirm.
 */
export function AlertDialog({
  title,
  description,
  tone = "danger",
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  isConfirming,
  ...props
}: AlertDialogProps) {
  return (
    <ModalOverlay className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-overlay-backdrop p-4" {...props}>
      <Modal className="w-full max-w-md">
        <AriaDialog
          role="alertdialog"
          className="flex flex-col gap-4 rounded-[var(--radius-panel)] border border-border bg-surface-raised p-6 shadow-overlay outline-none"
        >
          {(opts) => (
            <>
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full",
                    tone === "danger" ? "bg-danger-soft text-danger" : "bg-brand-soft text-brand",
                  )}
                >
                  <AlertTriangle className="size-5" aria-hidden="true" />
                </div>
                <div className="flex flex-col gap-1 pt-0.5">
                  <Heading slot="title" className="text-section font-semibold text-text">
                    {title}
                  </Heading>
                  <p className="text-sm text-text-secondary">{description}</p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onPress={opts.close} isDisabled={isConfirming}>
                  {cancelLabel}
                </Button>
                <Button
                  variant={tone === "danger" ? "danger" : "primary"}
                  isLoading={isConfirming}
                  onPress={() => {
                    onConfirm();
                  }}
                >
                  {confirmLabel}
                </Button>
              </div>
            </>
          )}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
