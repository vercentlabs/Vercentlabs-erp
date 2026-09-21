import { forwardRef, type ReactNode } from "react";
import {
  CheckboxGroup as AriaCheckboxGroup,
  type CheckboxGroupProps as AriaCheckboxGroupProps,
} from "react-aria-components";
import { FieldChrome, type FieldChromeProps } from "./field-chrome.tsx";
import { cn } from "../utilities/cn.ts";

export interface CheckboxGroupProps
  extends Omit<AriaCheckboxGroupProps, "className">,
    Pick<FieldChromeProps, "label" | "description" | "errorMessage" | "isRequired"> {
  className?: string;
  children: ReactNode;
  orientation?: "vertical" | "horizontal";
}

export const CheckboxGroup = forwardRef<HTMLDivElement, CheckboxGroupProps>(function CheckboxGroup(
  { className, label, description, errorMessage, isRequired, orientation = "vertical", children, ...props },
  ref,
) {
  return (
    <AriaCheckboxGroup ref={ref} isRequired={isRequired} isInvalid={props.isInvalid ?? (errorMessage ? true : undefined)} className={cn("group", className)} {...props}>
      <FieldChrome label={label} description={description} errorMessage={errorMessage} isRequired={isRequired}>
        <div className={cn("flex gap-3", orientation === "vertical" ? "flex-col" : "flex-row flex-wrap")}>
          {children}
        </div>
      </FieldChrome>
    </AriaCheckboxGroup>
  );
});
