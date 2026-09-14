import { Tabs as BaseTabs } from "@base-ui-components/react/tabs";
import type { ComponentProps } from "react";

import { cn } from "../utils/cn";

// Base UI's Tabs owns roving-tabindex arrow-key navigation and the
// tab<->panel aria-controls/aria-labelledby wiring (SP032) -- what Record
// 360 sections (Overview/Activity/Sales Context/Governance) need.
export const TabsRoot = BaseTabs.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof BaseTabs.List>) {
  return (
    <BaseTabs.List
      className={cn("relative flex gap-1 border-b border-[var(--color-border-default)]", className)}
      {...props}
    />
  );
}

export function TabsTab({ className, ...props }: ComponentProps<typeof BaseTabs.Tab>) {
  return (
    <BaseTabs.Tab
      className={cn(
        "relative px-3 py-2 text-[length:var(--text-sm)] font-medium text-[var(--color-text-secondary)] outline-none",
        "data-[selected]:text-[var(--color-action-primary)]",
        "focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] rounded-t-[var(--radius-control)]",
        className,
      )}
      {...props}
    />
  );
}

export function TabsIndicator({ className, ...props }: ComponentProps<typeof BaseTabs.Indicator>) {
  return (
    <BaseTabs.Indicator
      className={cn("absolute bottom-0 h-0.5 rounded-full bg-[var(--color-action-primary)] transition-all", className)}
      {...props}
    />
  );
}

export function TabsPanel({ className, ...props }: ComponentProps<typeof BaseTabs.Panel>) {
  return <BaseTabs.Panel className={cn("py-4 outline-none", className)} {...props} />;
}
