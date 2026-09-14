import { forwardRef, type ReactNode } from "react";
import {
  RadioGroup as AriaRadioGroup,
  Radio as AriaRadio,
  type RadioGroupProps as AriaRadioGroupProps,
  type RadioProps as AriaRadioProps,
} from "react-aria-components";
import { FieldChrome, type FieldChromeProps } from "./field-chrome.tsx";
import { cn } from "../utilities/cn.ts";

export interface RadioGroupProps
  extends Omit<AriaRadioGroupProps, "className">,
    Pick<FieldChromeProps, "label" | "description" | "errorMessage" | "isRequired"> {
  className?: string;
  children: ReactNode;
  orientation?: "vertical" | "horizontal";
}

export const RadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>(function RadioGroup(
  { className, label, description, errorMessage, isRequired, orientation = "vertical", children, ...props },
  ref,
) {
  return (
    <AriaRadioGroup ref={ref} isRequired={isRequired} className={cn("group", className)} {...props}>
      <FieldChrome label={label} description={description} errorMessage={errorMessage} isRequired={isRequired}>
        <div className={cn("flex gap-3", orientation === "vertical" ? "flex-col" : "flex-row flex-wrap")}>
          {children}
        </div>
      </FieldChrome>
    </AriaRadioGroup>
  );
});

export interface RadioProps extends Omit<AriaRadioProps, "className" | "children"> {
  className?: string;
  children?: ReactNode;
}

export const Radio = forwardRef<HTMLLabelElement, RadioProps>(function Radio({ className, children, ...props }, ref) {
  return (
    <AriaRadio
      ref={ref}
      className={cn("group flex items-center gap-2 text-sm text-text data-[disabled]:opacity-50", className)}
      {...props}
    >
      <div
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface",
          "transition-colors duration-[var(--motion-fast)]",
          "group-data-[focus-visible]:ring-2 group-data-[focus-visible]:ring-brand group-data-[focus-visible]:ring-offset-2",
          "group-data-[invalid]:border-danger group-data-[selected]:border-brand",
        )}
      >
        <div className="size-1.5 scale-0 rounded-full bg-brand transition-transform duration-[var(--motion-fast)] group-data-[selected]:scale-100" />
      </div>
      {children}
    </AriaRadio>
  );
});
