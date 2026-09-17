import { forwardRef, type ReactNode } from "react";
import { Checkbox as AriaCheckbox, type CheckboxProps as AriaCheckboxProps } from "react-aria-components";
import { Check, Minus } from "lucide-react";
import { cn } from "../utilities/cn.ts";

export interface CheckboxProps extends Omit<AriaCheckboxProps, "className" | "children"> {
  className?: string;
  children?: ReactNode;
}

export const Checkbox = forwardRef<HTMLLabelElement, CheckboxProps>(function Checkbox(
  { className, children, ...props },
  ref,
) {
  return (
    <AriaCheckbox
      ref={ref}
      className={cn("group flex items-center gap-2 text-sm text-text data-[disabled]:opacity-50", className)}
      {...props}
    >
      {({ isSelected, isIndeterminate }) => (
        <>
          <div
            className={cn(
              "flex size-4 shrink-0 items-center justify-center rounded border border-border-strong bg-surface",
              "transition-colors duration-[var(--motion-fast)]",
              "group-data-[pressed]:border-brand group-data-[focus-visible]:ring-2 group-data-[focus-visible]:ring-brand group-data-[focus-visible]:ring-offset-2",
              "group-data-[invalid]:border-danger",
              (isSelected || isIndeterminate) && "border-brand bg-brand",
            )}
          >
            {isIndeterminate ? (
              <Minus className="size-3 text-text-inverse" aria-hidden="true" />
            ) : isSelected ? (
              <Check className="size-3 text-text-inverse" aria-hidden="true" />
            ) : null}
          </div>
          {children}
        </>
      )}
    </AriaCheckbox>
  );
});
