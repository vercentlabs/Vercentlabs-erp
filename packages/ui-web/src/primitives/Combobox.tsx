import { Combobox as BaseCombobox } from "@base-ui-components/react/combobox";
import { Check, ChevronDown, X } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "../utils/cn";

// Backs both EntityLookupField (async search-and-select, e.g. lead owner)
// and MultiSelectField (multi-value chips, e.g. tags) -- unlike Select
// (static option list, no text filtering), Combobox owns filtering an
// arbitrary/async item list and multi-value chip removal, which those two
// field types need and Select structurally cannot do.
export const ComboboxRoot = BaseCombobox.Root;
export const ComboboxValue = BaseCombobox.Value;
export const ComboboxCollection = BaseCombobox.Collection;

export function ComboboxChips({ className, ...props }: ComponentProps<typeof BaseCombobox.Chips>) {
  return (
    <BaseCombobox.Chips
      className={cn(
        "flex min-h-[var(--control-standard)] w-full flex-wrap items-center gap-1 rounded-[var(--radius-control)] border border-[var(--color-border-default)] bg-[var(--color-surface)] px-2 py-1",
        "focus-within:ring-2 focus-within:ring-[var(--color-border-focus)]",
        className,
      )}
      {...props}
    />
  );
}

export function ComboboxChip({ className, children, ...props }: ComponentProps<typeof BaseCombobox.Chip>) {
  return (
    <BaseCombobox.Chip
      className={cn(
        "flex items-center gap-1 rounded-[var(--radius-pill)] bg-[var(--color-canvas-strong)] px-2 py-0.5 text-[length:var(--text-xs)] text-[var(--color-text-primary)]",
        className,
      )}
      {...props}
    >
      {children}
      <BaseCombobox.ChipRemove aria-label="Remove" className="rounded-full hover:bg-[var(--color-border-default)]">
        <X className="size-3" aria-hidden="true" />
      </BaseCombobox.ChipRemove>
    </BaseCombobox.Chip>
  );
}

export function ComboboxInput({ className, ...props }: ComponentProps<typeof BaseCombobox.Input>) {
  return (
    <BaseCombobox.Input
      className={cn(
        "h-[var(--control-standard)] w-full rounded-[var(--radius-control)] border border-[var(--color-border-default)] bg-[var(--color-surface)] px-3",
        "text-[length:var(--text-md)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-subtle)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-[var(--color-canvas)]",
        className,
      )}
      {...props}
    />
  );
}

export function ComboboxTrigger({ className, ...props }: ComponentProps<typeof BaseCombobox.Trigger>) {
  return (
    <BaseCombobox.Trigger className={cn("flex items-center justify-center px-2 text-[var(--color-text-muted)]", className)} {...props}>
      <ChevronDown className="size-4" aria-hidden="true" />
    </BaseCombobox.Trigger>
  );
}

export function ComboboxContent({ className, children, ...props }: ComponentProps<typeof BaseCombobox.Popup>) {
  return (
    <BaseCombobox.Portal>
      <BaseCombobox.Positioner sideOffset={4}>
        <BaseCombobox.Popup
          className={cn(
            "min-w-[var(--anchor-width)] rounded-[var(--radius-card)] border border-[var(--color-border-default)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-panel)]",
            "data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 transition-all",
            className,
          )}
          {...props}
        >
          <BaseCombobox.Empty className="px-2 py-4 text-center text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            No matches
          </BaseCombobox.Empty>
          <BaseCombobox.List>{children}</BaseCombobox.List>
        </BaseCombobox.Popup>
      </BaseCombobox.Positioner>
    </BaseCombobox.Portal>
  );
}

export function ComboboxItem({ className, children, ...props }: ComponentProps<typeof BaseCombobox.Item>) {
  return (
    <BaseCombobox.Item
      className={cn(
        "flex cursor-pointer items-center justify-between gap-2 rounded-[calc(var(--radius-card)-4px)] px-2 py-1.5 text-[length:var(--text-sm)] text-[var(--color-text-primary)] outline-none",
        "data-[highlighted]:bg-[var(--color-canvas-strong)]",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      <BaseCombobox.ItemIndicator className="flex size-3.5 items-center justify-center">
        <Check className="size-3.5" />
      </BaseCombobox.ItemIndicator>
    </BaseCombobox.Item>
  );
}
