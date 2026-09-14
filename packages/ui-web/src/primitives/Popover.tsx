import { Popover as BasePopover } from "@base-ui-components/react/popover";
import type { ComponentProps } from "react";

import { cn } from "../utils/cn";

// Used for the FilterBar's filter-editing panels: unlike Menu, Popover
// content can hold arbitrary interactive form controls (multiple selects,
// date ranges) without Base UI treating it as a single-select list.
export const PopoverRoot = BasePopover.Root;
export const PopoverTrigger = BasePopover.Trigger;
export const PopoverTitle = BasePopover.Title;
export const PopoverDescription = BasePopover.Description;
export const PopoverClose = BasePopover.Close;

export function PopoverContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof BasePopover.Popup> & { sideOffset?: number }) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner sideOffset={sideOffset}>
        <BasePopover.Popup
          className={cn(
            "min-w-[240px] rounded-[var(--radius-card)] border border-[var(--color-border-default)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-panel)]",
            "data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 transition-all",
            className,
          )}
          {...props}
        />
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
}
