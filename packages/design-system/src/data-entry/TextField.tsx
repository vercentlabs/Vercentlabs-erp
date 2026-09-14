import { forwardRef, type ReactNode } from "react";
import {
  TextField as AriaTextField,
  Input,
  type TextFieldProps as AriaTextFieldProps,
} from "react-aria-components";
import { FieldChrome, inputChrome, type FieldChromeProps } from "./field-chrome.tsx";
import { cn } from "../utilities/cn.ts";

export interface TextFieldProps
  extends Omit<AriaTextFieldProps, "className">,
    Pick<FieldChromeProps, "label" | "description" | "errorMessage"> {
  className?: string;
  size?: "compact" | "standard";
  placeholder?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { className, label, description, errorMessage, isRequired, size, placeholder, prefix, suffix, ...props },
  ref,
) {
  return (
    <AriaTextField isRequired={isRequired} className={cn("group", className)} {...props}>
      <FieldChrome label={label} description={description} errorMessage={errorMessage} isRequired={isRequired}>
        <div className={cn(inputChrome({ size }), "flex items-center gap-2 px-0")}>
          {prefix && <span className="pl-3 text-text-muted">{prefix}</span>}
          <Input
            ref={ref}
            placeholder={placeholder}
            className="h-full flex-1 bg-transparent px-3 outline-none placeholder:text-text-subtle"
          />
          {suffix && <span className="pr-3 text-text-muted">{suffix}</span>}
        </div>
      </FieldChrome>
    </AriaTextField>
  );
});
