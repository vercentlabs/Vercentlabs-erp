import type { DateValue } from "react-aria-components";
import { DatePicker, type DatePickerProps } from "./DatePicker.tsx";

export type DateTimeFieldProps<T extends DateValue> = DatePickerProps<T>;

/** DatePicker preset for combined date+time entry — pass a value type that
 * carries time (`CalendarDateTime`/`ZonedDateTime` from
 * `@internationalized/date`), which also switches DateInput's segments to
 * include hour/minute. Defaults `granularity="minute"` so a plain
 * `CalendarDate` value still surfaces a time segment; override for finer
 * granularity (e.g. `"second"`) where the domain needs it. */
export function DateTimeField<T extends DateValue>(props: DateTimeFieldProps<T>) {
  return <DatePicker granularity="minute" {...props} />;
}
