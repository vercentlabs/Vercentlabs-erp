import { Progress as BaseProgress } from "@base-ui-components/react/progress";
import type { ComponentProps } from "react";

import { cn } from "../utils/cn";

// For determinate background-job/import-export progress (SP033) --
// Base UI owns the aria-valuenow/aria-valuemin/aria-valuemax wiring and the
// indeterminate (`value={null}`) state's distinct ARIA presentation.
export function ProgressRoot({ className, children, ...props }: ComponentProps<typeof BaseProgress.Root>) {
  return (
    <BaseProgress.Root className={cn("flex flex-col gap-1", className)} {...props}>
      {children}
    </BaseProgress.Root>
  );
}

export function ProgressLabel({ className, ...props }: ComponentProps<typeof BaseProgress.Label>) {
  return <BaseProgress.Label className={cn("flex items-center justify-between text-[length:var(--text-sm)] text-[var(--color-text-primary)]", className)} {...props} />;
}

export function ProgressValue({ className, ...props }: ComponentProps<typeof BaseProgress.Value>) {
  return <BaseProgress.Value className={cn("text-[length:var(--text-sm)] text-[var(--color-text-muted)]", className)} {...props} />;
}

export function ProgressTrack({ className, ...props }: ComponentProps<typeof BaseProgress.Track>) {
  return <BaseProgress.Track className={cn("h-2 w-full overflow-hidden rounded-[var(--radius-pill)] bg-[var(--color-canvas-strong)]", className)} {...props} />;
}

export function ProgressIndicator({ className, ...props }: ComponentProps<typeof BaseProgress.Indicator>) {
  return (
    <BaseProgress.Indicator
      className={cn("h-full rounded-[var(--radius-pill)] bg-[var(--color-action-primary)] transition-[width] data-[indeterminate]:animate-pulse", className)}
      {...props}
    />
  );
}
