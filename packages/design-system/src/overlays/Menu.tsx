import type { ReactNode } from "react";
import {
  Header,
  MenuSection as AriaMenuSection,
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
import { useTranslateText } from "../utilities/translate.tsx";

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
  const t = useTranslateText();
  return (
    <AriaMenuItem
      className={cn(listBoxItemChrome, isDanger && "text-danger data-[focused]:bg-danger-soft", className)}
      {...props}
    >
      {t(children)}
    </AriaMenuItem>
  );
}

export const MenuSeparator = () => <Separator className="my-1 h-px bg-border" />;

/** A titled group of menu items ("Ownership", "Status"). */
export function MenuSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <AriaMenuSection className="flex flex-col gap-0.5">
      {title && <Header className="px-2 pt-1.5 pb-0.5 text-xs font-semibold tracking-wide text-text-muted uppercase">{title}</Header>}
      {children}
    </AriaMenuSection>
  );
}

export { MenuTrigger };
