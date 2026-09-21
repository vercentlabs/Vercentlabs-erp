import {
  TimeField as AriaTimeField,
  DateInput,
  DateSegment,
  type TimeFieldProps as AriaTimeFieldProps,
  type TimeValue,
} from "react-aria-components";
import { FieldChrome, inputChrome, type FieldChromeProps } from "./field-chrome.tsx";
import { cn } from "../utilities/cn.ts";

export interface TimeFieldProps<T extends TimeValue>
  extends Omit<AriaTimeFieldProps<T>, "className">,
    Pick<FieldChromeProps, "label" | "description" | "errorMessage" | "isRequired"> {
  className?: string;
  size?: "compact" | "standard";
}

export function TimeField<T extends TimeValue>({
  className,
  label,
  description,
  errorMessage,
  isRequired,
  size,
  ...props
}: TimeFieldProps<T>) {
  return (
    <AriaTimeField isRequired={isRequired} isInvalid={props.isInvalid ?? (errorMessage ? true : undefined)} className={cn("group flex flex-col gap-1.5", className)} {...props}>
      <FieldChrome label={label} description={description} errorMessage={errorMessage} isRequired={isRequired}>
        <DateInput className={cn(inputChrome({ size }), "flex items-center gap-0.5")}>
          {(segment) => (
            <DateSegment
              segment={segment}
              className="rounded px-0.5 tabular-nums outline-none data-[placeholder]:text-text-muted data-[focused]:bg-brand-soft"
            />
          )}
        </DateInput>
      </FieldChrome>
    </AriaTimeField>
  );
}
