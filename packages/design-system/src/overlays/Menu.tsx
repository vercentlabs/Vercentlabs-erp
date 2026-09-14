import type { ReactNode } from "react";
import {
  MenuTrigger,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  Separator,
  Popover,
  type MenuProps as AriaMenuProps,
  type MenuItemProps as AriaMenuItemProps,
} from "react-aria-components";
import { popoverChrome, listBoxItemChrome } from "../utilities/overlay-chrome.ts";
import { cn } from "../utilities/cn.ts";

export interface MenuProps<T extends object> extends Omit<AriaMenuProps<T>, "className"> {
  className?: string;
}

export function Menu<T extends object>({ className, ...props }: MenuProps<T>) {
  return (
    <Popover className={cn(popoverChrome, "min-w-48 p-1")}>
      <AriaMenu className={cn("flex flex-col gap-0.5 outline-none", className)} {...props} />
    </Popover>
  );
}

export interface MenuItemProps extends Omit<AriaMenuItemProps, "className" | "children"> {
  className?: string;
  children: ReactNode;
  /** Renders in danger styling — for "Delete", "Cancel order", etc. */
  isDanger?: boolean;
}

export function MenuItem({ className, children, isDanger, ...props }: MenuItemProps) {
  return (
    <AriaMenuItem
      className={cn(listBoxItemChrome, isDanger && "text-danger data-[focused]:bg-danger-soft", className)}
      {...props}
    >
      {children}
    </AriaMenuItem>
  );
}

export const MenuSeparator = () => <Separator className="my-1 h-px bg-border" />;

export { MenuTrigger };
