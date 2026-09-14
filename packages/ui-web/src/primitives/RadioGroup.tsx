import { Radio } from "@base-ui-components/react/radio";
import { RadioGroup as BaseRadioGroup } from "@base-ui-components/react/radio-group";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "../utils/cn";

// Base UI's RadioGroup owns roving-tabindex arrow-key navigation between
// options and the group<->option name/checked wiring (SP032) -- used for
// small (2-5), always-visible mutually-exclusive choices; Select is for
// larger or space-constrained option lists.
export const RadioGroupRoot = BaseRadioGroup;

export function RadioGroupItem({ className, children, value, ...props }: ComponentProps<typeof Radio.Root> & { children?: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--color-text-primary)]">
      <Radio.Root
        value={value}
        className={cn(
          "flex size-4 items-center justify-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)]",
          "data-[checked]:border-[var(--color-action-primary)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] focus-visible:ring-offset-1",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        <Radio.Indicator className="size-2 rounded-full bg-[var(--color-action-primary)] data-[unchecked]:hidden" />
      </Radio.Root>
      {children}
    </label>
  );
}
