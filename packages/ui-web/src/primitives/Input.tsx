import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";

import { cn } from "../utils/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, disabled, ...props }, ref) => {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        className={cn(
          "flex h-[var(--control-standard)] w-full rounded-[var(--radius-control)] border bg-[var(--color-surface)] px-3",
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
Input.displayName = "Input";
