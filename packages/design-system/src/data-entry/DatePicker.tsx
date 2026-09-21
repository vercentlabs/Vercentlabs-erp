import {
  DatePicker as AriaDatePicker,
  DateInput,
  DateSegment,
  Group,
  Button,
  Popover,
  Dialog,
  Calendar,
  CalendarGrid,
  CalendarCell,
  Heading,
  type DatePickerProps as AriaDatePickerProps,
  type DateValue,
} from "react-aria-components";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { FieldChrome, inputChrome, type FieldChromeProps } from "./field-chrome.tsx";
import { popoverChrome } from "../utilities/overlay-chrome.ts";
import { cn } from "../utilities/cn.ts";

export interface DatePickerProps<T extends DateValue>
  extends Omit<AriaDatePickerProps<T>, "className">,
    Pick<FieldChromeProps, "label" | "description" | "errorMessage" | "isRequired"> {
  className?: string;
  size?: "compact" | "standard";
}

export function DatePicker<T extends DateValue>({
  className,
  label,
  description,
  errorMessage,
  isRequired,
  size,
  ...props
}: DatePickerProps<T>) {
  return (
    <AriaDatePicker isRequired={isRequired} isInvalid={props.isInvalid ?? (errorMessage ? true : undefined)} className={cn("group flex flex-col gap-1.5", className)} {...props}>
      <FieldChrome label={label} description={description} errorMessage={errorMessage} isRequired={isRequired}>
        <Group className={cn(inputChrome({ size }), "flex items-center gap-1 px-0")}>
          <DateInput className="flex min-w-0 flex-1 items-center gap-0.5 px-3">
            {(segment) => (
              <DateSegment
                segment={segment}
                className="rounded px-0.5 tabular-nums outline-none data-[placeholder]:text-text-muted data-[focused]:bg-brand-soft"
              />
            )}
          </DateInput>
          <Button className="flex h-full shrink-0 items-center px-2 text-text-muted hover:text-text">
            <CalendarDays className="size-4" aria-hidden="true" />
          </Button>
        </Group>
      </FieldChrome>
      <Popover className={cn(popoverChrome, "p-3")}>
        <Dialog className="outline-none">
          <Calendar>
            <header className="mb-2 flex items-center justify-between">
              <Button slot="previous" className="flex size-7 items-center justify-center rounded text-text-muted hover:bg-surface-muted hover:text-text">
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Button>
              <Heading className="text-sm font-medium text-text" />
              <Button slot="next" className="flex size-7 items-center justify-center rounded text-text-muted hover:bg-surface-muted hover:text-text">
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </header>
            <CalendarGrid className="border-collapse">
              {(date) => (
                <CalendarCell
                  date={date}
                  className={cn(
                    "flex size-8 cursor-default items-center justify-center rounded-[var(--radius-control)] text-sm tabular-nums outline-none",
                    "data-[hovered]:bg-surface-muted data-[selected]:bg-brand data-[selected]:text-text-inverse",
                    "data-[outside-month]:text-text-muted data-[unavailable]:pointer-events-none data-[unavailable]:text-text-muted data-[unavailable]:line-through",
                    "data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand",
                  )}
                />
              )}
            </CalendarGrid>
          </Calendar>
        </Dialog>
      </Popover>
    </AriaDatePicker>
  );
}
