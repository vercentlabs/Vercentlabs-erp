import {
  Tabs as AriaTabs,
  TabList as AriaTabList,
  Tab as AriaTab,
  TabPanel as AriaTabPanel,
  type TabsProps as AriaTabsProps,
  type TabListProps as AriaTabListProps,
  type TabProps as AriaTabProps,
  type TabPanelProps as AriaTabPanelProps,
} from "react-aria-components";
import { cn } from "../utilities/cn.ts";

export type TabsProps = Omit<AriaTabsProps, "className"> & { className?: string };
export function Tabs({ className, ...props }: TabsProps) {
  return <AriaTabs className={cn("flex flex-col gap-3", className)} {...props} />;
}

export type TabListProps<T extends object> = Omit<AriaTabListProps<T>, "className"> & { className?: string };
export function TabList<T extends object>({ className, ...props }: TabListProps<T>) {
  return (
    <AriaTabList
      className={cn("flex max-w-full gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:thin]", className)}
      {...props}
    />
  );
}

export type TabProps = Omit<AriaTabProps, "className"> & { className?: string };
export function Tab({ className, ...props }: TabProps) {
  return (
    <AriaTab
      className={cn(
        "relative flex shrink-0 cursor-default items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap text-text-secondary outline-none",
        "border-b-2 border-transparent transition-colors duration-[var(--motion-fast)]",
        "hover:text-text",
        "data-[selected]:border-brand data-[selected]:text-text",
        "data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand data-[focus-visible]:ring-inset",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export type TabPanelProps = Omit<AriaTabPanelProps, "className"> & { className?: string };
export function TabPanel({ className, ...props }: TabPanelProps) {
  return <AriaTabPanel className={cn("outline-none", className)} {...props} />;
}
