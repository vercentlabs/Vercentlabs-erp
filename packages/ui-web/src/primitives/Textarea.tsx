import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";

import { cn } from "../utils/cn";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, disabled, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        className={cn(
          "flex min-h-[calc(var(--control-standard)*2)] w-full rounded-[var(--radius-control)] border bg-[var(--color-surface)] px-3 py-2",
          "text-[length:var(--text-md)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-subtle)]",
          "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-[var(--color-canvas)]",
          invalid ? "border-[var(--color-state-danger)]" : "border-[var(--color-border-default)]",
          className,
        )}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";
