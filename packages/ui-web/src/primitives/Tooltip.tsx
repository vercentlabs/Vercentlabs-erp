import { Tooltip as BaseTooltip } from "@base-ui-components/react/tooltip";
import type { ComponentProps } from "react";

import { cn } from "../utils/cn";

// TooltipProvider should wrap a screen/app once so hover delays are shared
// across every tooltip on it (SP032: consistent, predictable timing) rather
// than each Tooltip.Root re-deriving its own.
export const TooltipProvider = BaseTooltip.Provider;
export const TooltipRoot = BaseTooltip.Root;
export const TooltipTrigger = BaseTooltip.Trigger;

export function TooltipContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof BaseTooltip.Popup> & { sideOffset?: number }) {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner sideOffset={sideOffset}>
        <BaseTooltip.Popup
          className={cn(
            "rounded-[var(--radius-control)] bg-[var(--color-canvas-strong)] px-2 py-1 text-[length:var(--text-xs)] text-[var(--color-text-primary)] shadow-[var(--shadow-panel)]",
            "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity",
            className,
          )}
          {...props}
        />
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  );
}
