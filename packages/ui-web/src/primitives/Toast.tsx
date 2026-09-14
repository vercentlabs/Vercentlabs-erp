import { Toast as BaseToast } from "@base-ui-components/react/toast";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../utils/cn";

// `ToastProvider` wraps the app/module surface once; `useToast()` (a
// thin re-export of Base UI's own `useToastManager`) is what a screen
// calls to actually show one -- `toast.add({ title, type })` -- e.g. after
// a background job completes or a bulk action finishes (SP033). `Toaster`
// renders the live region + visible stack and is mounted once, alongside
// `ToastProvider`, not per-screen.
export const ToastProvider = BaseToast.Provider;
export const useToast = BaseToast.useToastManager;

const TONE_ICON = {
  success: CheckCircle2,
  error: AlertCircle,
  default: Info,
} as const;

function ToastItem({ toast }: { toast: { id: string; title?: ReactNode; description?: ReactNode; type?: string } }) {
  const Icon = TONE_ICON[(toast.type as keyof typeof TONE_ICON) || "default"] || Info;
  return (
    <BaseToast.Root
      toast={toast}
      className={cn(
        "flex items-start gap-2 rounded-[var(--radius-card)] border border-[var(--color-border-default)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-overlay)]",
        "data-[starting-style]:opacity-0 data-[starting-style]:translate-y-2 data-[ending-style]:opacity-0 transition-all",
        toast.type === "error" && "border-[var(--color-state-danger-soft)]",
        toast.type === "success" && "border-[var(--color-state-success-soft)]",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          toast.type === "error" ? "text-[var(--color-state-danger)]" : toast.type === "success" ? "text-[var(--color-state-success)]" : "text-[var(--color-text-muted)]",
        )}
        aria-hidden="true"
      />
      <div className="flex-1">
        {toast.title ? <BaseToast.Title className="text-[length:var(--text-sm)] font-medium text-[var(--color-text-primary)]">{toast.title}</BaseToast.Title> : null}
        {toast.description ? <BaseToast.Description className="mt-0.5 text-[length:var(--text-sm)] text-[var(--color-text-secondary)]">{toast.description}</BaseToast.Description> : null}
      </div>
      <BaseToast.Close aria-label="Dismiss" className="rounded p-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-canvas-strong)]">
        <X className="size-3.5" aria-hidden="true" />
      </BaseToast.Close>
    </BaseToast.Root>
  );
}

export function Toaster() {
  const { toasts } = BaseToast.useToastManager();
  return (
    <BaseToast.Portal>
      <BaseToast.Viewport className="fixed bottom-4 right-4 z-[var(--z-toast)] flex w-80 flex-col gap-2">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} />
        ))}
      </BaseToast.Viewport>
    </BaseToast.Portal>
  );
}
