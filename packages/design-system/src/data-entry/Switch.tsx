import { forwardRef, type ReactNode } from "react";
import { Switch as AriaSwitch, type SwitchProps as AriaSwitchProps } from "react-aria-components";
import { cn } from "../utilities/cn.ts";

export interface SwitchProps extends Omit<AriaSwitchProps, "className" | "children"> {
  className?: string;
  children?: ReactNode;
}

export const Switch = forwardRef<HTMLLabelElement, SwitchProps>(function Switch({ className, children, ...props }, ref) {
  return (
    <AriaSwitch
      ref={ref}
      className={cn("group relative flex items-center gap-2 text-sm text-text data-[disabled]:opacity-50", className)}
      {...props}
    >
      <div
        className={cn(
          "flex h-5 w-8 shrink-0 items-center rounded-pill border border-border-strong bg-canvas-strong p-0.5",
          "transition-colors duration-[var(--motion-standard)]",
          "group-data-[selected]:border-brand group-data-[selected]:bg-brand",
          "group-data-[focus-visible]:ring-2 group-data-[focus-visible]:ring-brand group-data-[focus-visible]:ring-offset-2",
        )}
      >
        <div className="size-3.5 rounded-full bg-surface shadow-subtle transition-transform duration-[var(--motion-standard)] group-data-[selected]:translate-x-3" />
      </div>
      {children}
    </AriaSwitch>
  );
});
