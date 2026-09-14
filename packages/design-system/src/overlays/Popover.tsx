import type { ReactNode } from "react";
import { DialogTrigger, Popover as AriaPopover, Dialog, type PopoverProps as AriaPopoverProps } from "react-aria-components";
import { popoverChrome } from "../utilities/overlay-chrome.ts";
import { cn } from "../utilities/cn.ts";

export interface PopoverProps extends Omit<AriaPopoverProps, "className" | "children"> {
  className?: string;
  children: ReactNode;
}

/** The floating panel half of a trigger+Popover pair — pair with
 * `<DialogTrigger>` (a trigger element as the first child, `<Popover>` as
 * the second). For a fixed option list, Select/ComboBox/MultiSelect
 * already include their own popover; reach for this when the content
 * isn't a list (a filter panel, an inline editor, a mini-form). */
export function Popover({ className, children, ...props }: PopoverProps) {
  return (
    <AriaPopover className={cn(popoverChrome, "p-4")} {...props}>
      <Dialog className={cn("outline-none", className)}>{children}</Dialog>
    </AriaPopover>
  );
}

export { DialogTrigger as PopoverTrigger };
