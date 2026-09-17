import {
  DateField as AriaDateField,
  DateInput,
  DateSegment,
  type DateFieldProps as AriaDateFieldProps,
  type DateValue,
} from "react-aria-components";
import { FieldChrome, inputChrome, type FieldChromeProps } from "./field-chrome.tsx";
import { cn } from "../utilities/cn.ts";

export interface DateFieldProps<T extends DateValue>
  extends Omit<AriaDateFieldProps<T>, "className">,
    Pick<FieldChromeProps, "label" | "description" | "errorMessage" | "isRequired"> {
  className?: string;
  size?: "compact" | "standard";
}

/** Segmented date entry (no calendar popup) — for a date the user is
 * expected to type (a known birthdate, an effective-from date). For
 * calendar-driven picking, use DatePicker. */
export function DateField<T extends DateValue>({
  className,
  label,
  description,
  errorMessage,
  isRequired,
  size,
  ...props
}: DateFieldProps<T>) {
  return (
    <AriaDateField isRequired={isRequired} className={cn("group flex flex-col gap-1.5", className)} {...props}>
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
    </AriaDateField>
  );
}
