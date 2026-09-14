import { forwardRef } from "react";
import {
  TextField as AriaTextField,
  TextArea as AriaTextAreaInput,
  type TextFieldProps as AriaTextFieldProps,
} from "react-aria-components";
import { FieldChrome, type FieldChromeProps } from "./field-chrome.tsx";
import { cn } from "../utilities/cn.ts";

export interface TextAreaProps
  extends Omit<AriaTextFieldProps, "className">,
    Pick<FieldChromeProps, "label" | "description" | "errorMessage"> {
  className?: string;
  rows?: number;
  placeholder?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className, label, description, errorMessage, isRequired, rows = 4, placeholder, ...props },
  ref,
) {
  return (
    <AriaTextField isRequired={isRequired} className={cn("group", className)} {...props}>
      <FieldChrome label={label} description={description} errorMessage={errorMessage} isRequired={isRequired}>
        <AriaTextAreaInput
          ref={ref}
          rows={rows}
          placeholder={placeholder}
          className={[
            "w-full resize-y rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-sm text-text",
            "outline-none transition-colors duration-[var(--motion-fast)] placeholder:text-text-subtle",
            "hover:border-border-strong focus:border-brand focus:ring-2 focus:ring-focus",
            "group-data-[invalid]:border-danger group-data-[disabled]:pointer-events-none group-data-[disabled]:opacity-50",
          ].join(" ")}
        />
      </FieldChrome>
    </AriaTextField>
  );
});
