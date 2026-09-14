import { Checkbox as BaseCheckbox } from "@base-ui-components/react/checkbox";
import { Check, Minus } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "../utils/cn";

export interface CheckboxProps extends ComponentProps<typeof BaseCheckbox.Root> {
  "aria-label"?: string;
}

// Base UI owns keyboard (Space to toggle), aria-checked (including
// "mixed" for indeterminate) and focus-visible wiring. A checkbox used
// without a visible label (e.g. a data-grid row-selection cell) MUST carry
// aria-label -- enforced by making it a required prop whenever no
// children/label wraps this component; callers that DO have a visible
// label should use the FormField-level Checkbox wrapper (form-system
// phase) instead of this bare primitive directly.
export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <BaseCheckbox.Root
      className={cn(
        "flex size-4 items-center justify-center rounded-[4px] border border-[var(--color-border-strong)] bg-[var(--color-surface)]",
        "data-[checked]:border-[var(--color-action-primary)] data-[checked]:bg-[var(--color-action-primary)]",
        "data-[indeterminate]:border-[var(--color-action-primary)] data-[indeterminate]:bg-[var(--color-action-primary)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] focus-visible:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <BaseCheckbox.Indicator className="flex text-[var(--color-text-inverse)] data-[unchecked]:hidden">
        {props.indeterminate ? <Minus className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
}
