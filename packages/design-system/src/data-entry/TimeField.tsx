import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Time } from "@internationalized/date";
import { Clock } from "lucide-react";
import {
  TimeField as AriaTimeField,
  Button,
  DateInput,
  DateSegment,
  ListBox,
  ListBoxItem,
  Popover,
  useLocale,
  type TimeFieldProps as AriaTimeFieldProps,
  type TimeValue,
} from "react-aria-components";
import { FieldChrome, inputChrome, type FieldChromeProps } from "./field-chrome.tsx";
import { listBoxItemChrome, popoverChrome } from "../utilities/overlay-chrome.ts";
import { cn } from "../utilities/cn.ts";

export interface TimeFieldProps<T extends TimeValue>
  extends Omit<AriaTimeFieldProps<T>, "className">,
    Pick<FieldChromeProps, "label" | "description" | "errorMessage" | "isRequired"> {
  className?: string;
  size?: "compact" | "standard";
  // Shown instead of the empty "–:– am" segments until the field is focused (for example "Any time").
  placeholder?: string;
  // Minutes between the times offered in the list; any minute can still be typed.
  step?: number;
}

const keyOf = (hour: number, minute: number) => `${hour}:${minute}`;

// A time is typed into the hour and minute segments, or picked from a list that opens from the clock
// (or a click on an empty field). Picking sets a Time, so the list is for fields that hold a time of day.
export function TimeField<T extends TimeValue>({
  className,
  label,
  description,
  errorMessage,
  isRequired,
  size,
  placeholder,
  step = 30,
  ...props
}: TimeFieldProps<T>) {
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const { locale } = useLocale();
  const current = props.value === undefined ? props.defaultValue : props.value;
  const empty = !current;
  const selectedKey = current ? keyOf(current.hour, current.minute) : null;

  const times = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });
    const entries: { key: string; hour: number; minute: number; label: string }[] = [];
    for (let minutes = 0; minutes < 24 * 60; minutes += step) {
      const hour = Math.floor(minutes / 60);
      const minute = minutes % 60;
      entries.push({ key: keyOf(hour, minute), hour, minute, label: format.format(new Date(2000, 0, 1, hour, minute)) });
    }
    return entries;
  }, [locale, step]);

  // Open on the chosen time, else at 9 am, the start of a working day.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const target = list.current?.querySelector(`[data-key="${selectedKey ?? keyOf(9, 0)}"]`);
      target?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, selectedKey]);

  // A click on the box outside the segments: an empty field opens the list, a filled one starts typing at the hour.
  const onBoxClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('[role="spinbutton"], button') || props.isDisabled || props.isReadOnly) return;
    if (empty) setOpen(true);
    else box.current?.querySelector<HTMLElement>('[role="spinbutton"]')?.focus();
  };

  const pick = (key: string) => {
    const time = times.find((entry) => entry.key === key);
    if (!time) return;
    props.onChange?.(new Time(time.hour, time.minute) as unknown as Parameters<NonNullable<typeof props.onChange>>[0]);
    setOpen(false);
  };

  return (
    <AriaTimeField isRequired={isRequired} isInvalid={props.isInvalid ?? (errorMessage ? true : undefined)} className={cn("group flex flex-col gap-1.5", className)} {...props}>
      <FieldChrome label={label} description={description} errorMessage={errorMessage} isRequired={isRequired}>
        <div ref={box} onClick={onBoxClick}
          className={cn(inputChrome({ size }), "relative flex cursor-pointer items-center gap-1 pr-0", placeholder && empty && "[&:not(:focus-within)_.time-segment]:opacity-0")}>
          <DateInput className="flex min-w-0 flex-1 items-center gap-0.5">
            {(segment) => (
              <DateSegment
                segment={segment}
                className="time-segment cursor-text rounded px-0.5 tabular-nums outline-none data-[placeholder]:text-text-muted data-[focused]:bg-brand-soft"
              />
            )}
          </DateInput>
          {placeholder && empty && (
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-text-muted group-focus-within:hidden">
              {placeholder}
            </span>
          )}
          <Button aria-label="Pick a time" onPress={() => setOpen(true)} isDisabled={props.isDisabled || props.isReadOnly}
            className="flex h-full shrink-0 items-center px-2 text-text-muted outline-none hover:text-text data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand">
            <Clock className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <Popover triggerRef={box} isOpen={open} onOpenChange={setOpen} placement="bottom start"
          className={cn(popoverChrome, "w-[var(--trigger-width)] min-w-36 overflow-hidden")}>
          <ListBox ref={list} aria-label={typeof label === "string" ? `${label} options` : "Times"} autoFocus
            selectionMode="single" disallowEmptySelection selectedKeys={selectedKey ? [selectedKey] : []}
            onSelectionChange={(keys) => { const [key] = [...keys]; if (key !== undefined) pick(String(key)); }}
            className="max-h-60 overflow-y-auto p-1 outline-none">
            {times.map((time) => (
              <ListBoxItem key={time.key} id={time.key} textValue={time.label} className={cn(listBoxItemChrome, "tabular-nums")}>
                {time.label}
              </ListBoxItem>
            ))}
          </ListBox>
        </Popover>
      </FieldChrome>
    </AriaTimeField>
  );
}
