import type { ReactNode } from "react";
import {
  TooltipTrigger,
  Tooltip as AriaTooltip,
  OverlayArrow,
  type TooltipProps as AriaTooltipProps,
  type TooltipTriggerComponentProps,
} from "react-aria-components";
import { cn } from "../utilities/cn.ts";

export interface TooltipProps extends Omit<AriaTooltipProps, "className" | "children"> {
  className?: string;
  children: ReactNode;
}

export function Tooltip({ className, children, ...props }: TooltipProps) {
  return (
    <AriaTooltip
      className={cn(
        "rounded-[var(--radius-control)] border border-border bg-navigation px-2 py-1 text-xs text-navigation-text shadow-panel",
        className,
      )}
      offset={6}
      {...props}
    >
      <OverlayArrow>
        <svg width={8} height={8} viewBox="0 0 8 8" className="fill-navigation">
          <path d="M0 0 L4 4 L8 0" />
        </svg>
      </OverlayArrow>
      {children}
    </AriaTooltip>
  );
}

export { TooltipTrigger };
export type { TooltipTriggerComponentProps };
