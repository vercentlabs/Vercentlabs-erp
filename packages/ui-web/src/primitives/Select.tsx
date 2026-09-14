import { Select as BaseSelect } from "@base-ui-components/react/select";
import { Check, ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "../utils/cn";

// Used for filter-bar single-select filters (stage/status/source/owner) and
// as the base for SelectField in the form system. Base UI's Select owns
// listbox keyboard navigation, type-ahead and the trigger<->popup ARIA
// wiring (SP032) -- this only supplies the ERP visual language.
export const SelectRoot = BaseSelect.Root;
export const SelectValue = BaseSelect.Value;
export const SelectGroup = BaseSelect.Group;
export const SelectGroupLabel = BaseSelect.GroupLabel;

export function SelectTrigger({ className, children, ...props }: ComponentProps<typeof BaseSelect.Trigger>) {
  return (
    <BaseSelect.Trigger
      className={cn(
        "flex h-[var(--control-standard)] w-full items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-default)] bg-[var(--color-surface)] px-3",
        "text-[length:var(--text-md)] text-[var(--color-text-primary)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-[var(--color-canvas)]",
        className,
      )}
      {...props}
    >
      {children}
      <BaseSelect.Icon>
        <ChevronDown className="size-4 text-[var(--color-text-muted)]" aria-hidden="true" />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  );
}

export function SelectContent({ className, children, ...props }: ComponentProps<typeof BaseSelect.Popup>) {
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner sideOffset={4}>
        <BaseSelect.Popup
          className={cn(
            "min-w-[var(--anchor-width)] rounded-[var(--radius-card)] border border-[var(--color-border-default)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-panel)]",
            "data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 transition-all",
            className,
          )}
          {...props}
        >
          <BaseSelect.List>{children}</BaseSelect.List>
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  );
}

export function SelectItem({ className, children, ...props }: ComponentProps<typeof BaseSelect.Item>) {
  return (
    <BaseSelect.Item
      className={cn(
        "flex cursor-pointer items-center justify-between gap-2 rounded-[calc(var(--radius-card)-4px)] px-2 py-1.5 text-[length:var(--text-sm)] text-[var(--color-text-primary)] outline-none",
        "data-[highlighted]:bg-[var(--color-canvas-strong)]",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <BaseSelect.ItemText>{children}</BaseSelect.ItemText>
      <BaseSelect.ItemIndicator className="flex size-3.5 items-center justify-center">
        <Check className="size-3.5" />
      </BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  );
}
