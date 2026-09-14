import { Menu } from "@base-ui-components/react/menu";
import { Check } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "../utils/cn";

// Base UI's Menu owns roving-tabindex keyboard navigation (arrow keys,
// Home/End, type-ahead), Escape-to-close and focus restoration -- exactly
// what a row-actions/bulk-action menu needs and what is easy to get
// subtly wrong hand-rolling per module.
export const DropdownMenuRoot = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;
export const DropdownMenuGroupLabel = Menu.GroupLabel;

export function DropdownMenuContent({ className, sideOffset = 4, ...props }: ComponentProps<typeof Menu.Popup> & { sideOffset?: number }) {
  return (
    <Menu.Portal>
      <Menu.Positioner sideOffset={sideOffset}>
        <Menu.Popup
          className={cn(
            "min-w-[180px] rounded-[var(--radius-card)] border border-[var(--color-border-default)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-panel)]",
            "data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 transition-all",
            className,
          )}
          {...props}
        />
      </Menu.Positioner>
    </Menu.Portal>
  );
}

export function DropdownMenuItem({ className, variant, ...props }: ComponentProps<typeof Menu.Item> & { variant?: "default" | "danger" }) {
  return (
    <Menu.Item
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-[calc(var(--radius-card)-4px)] px-2 py-1.5 text-[length:var(--text-sm)] text-[var(--color-text-primary)] outline-none",
        "data-[highlighted]:bg-[var(--color-canvas-strong)]",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        variant === "danger" && "text-[var(--color-state-danger)] data-[highlighted]:bg-[var(--color-state-danger-soft)]",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({ className, children, ...props }: ComponentProps<typeof Menu.CheckboxItem>) {
  return (
    <Menu.CheckboxItem
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-[calc(var(--radius-card)-4px)] px-2 py-1.5 text-[length:var(--text-sm)] text-[var(--color-text-primary)] outline-none",
        "data-[highlighted]:bg-[var(--color-canvas-strong)]",
        className,
      )}
      {...props}
    >
      <Menu.CheckboxItemIndicator className="flex size-3.5 items-center justify-center">
        <Check className="size-3.5" />
      </Menu.CheckboxItemIndicator>
      {children}
    </Menu.CheckboxItem>
  );
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<"div">) {
  return <div role="separator" className={cn("my-1 h-px bg-[var(--color-border-default)]", className)} {...props} />;
}
