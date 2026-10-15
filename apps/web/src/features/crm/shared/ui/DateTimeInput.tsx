"use client";

// Date and time entry on the design system's React Aria fields. They follow the app's locale (I18nProvider, en-IN by default), so a
// date reads dd/mm/yyyy and a time 12-hour, whatever the browser's language — a native <input type="date"> would follow the browser.
// The helpers keep plain strings at their edges: "YYYY-MM-DD" for a date, "HH:MM" for a time, the ISO instant for a date and time.
import { DatePicker, TimeField, parseDate, parseTime, type CalendarDate, type Time } from "@vercentlabs/design-system";

import {
  browserTimezone,
  isoToLocalParts,
  localToIso,
  timezoneLabel,
} from "@/shared/format/human";

const pad = (value: number) => String(value).padStart(2, "0");

function toCalendarDate(value: string): CalendarDate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  try {
    return parseDate(value);
  } catch {
    return null;
  }
}

function toTime(value: string): Time | null {
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  try {
    return parseTime(value);
  } catch {
    return null;
  }
}

const timeString = (time: Time | null) => (time ? `${pad(time.hour)}:${pad(time.minute)}` : "");

// Date + time entry with the time zone stated. The value it hands back is the ISO instant the backend already
// stores, so nothing downstream changes; nobody types a timestamp by hand.
export function DateTimeInput({
  label,
  value,
  onChange,
  timeZone,
  isRequired,
  errorMessage,
  description,
  className,
  hideZone,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  timeZone?: string;
  isRequired?: boolean;
  errorMessage?: string;
  description?: string;
  className?: string;
  hideZone?: boolean;
}) {
  const zone = timeZone ?? browserTimezone();
  const parts = isoToLocalParts(value, zone);
  const emit = (date: string, time: string) =>
    onChange(date ? localToIso(date, time || "09:00", zone) : "");
  return (
    <fieldset className={className}>
      <legend className="mb-1 text-sm font-medium text-text">
        {label}
        {isRequired && <span className="text-danger"> *</span>}
      </legend>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,9rem)] gap-2">
        <DatePicker
          aria-label={`${label} date`}
          value={toCalendarDate(parts.date)}
          onChange={(date) => emit(date ? date.toString() : "", parts.time)}
          isRequired={isRequired}
        />
        <TimeField
          aria-label={`${label} time`}
          value={toTime(parts.time)}
          onChange={(time) => emit(parts.date, timeString(time))}
          isRequired={isRequired}
        />
      </div>
      {errorMessage ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {errorMessage}
        </p>
      ) : description ? (
        <p className="mt-1 text-xs text-text-muted">{description}</p>
      ) : null}
      {!hideZone && (
        <p className="mt-1 text-xs text-text-muted">{timezoneLabel(zone)}</p>
      )}
    </fieldset>
  );
}

// A date only (no time of day): the stored value stays YYYY-MM-DD.
// `value` is typed as string, but a server component that loads the record
// straight from Postgres (rather than through a JSON fetch) hands a DATE
// column across as a real Date instance — RSC serialization preserves it
// as one, and JSON.stringify never runs to coerce it. Guard the same way
// shared/format/human.ts's own toDate() already does for the identical reason.
export function DateInput({
  label,
  value,
  onChange,
  isRequired,
  errorMessage,
  description,
  className,
}: {
  label: string;
  value: string | Date;
  onChange: (date: string) => void;
  isRequired?: boolean;
  errorMessage?: string;
  description?: string;
  className?: string;
}) {
  const iso = value instanceof Date ? value.toISOString() : value;
  return (
    <DatePicker
      label={label}
      value={toCalendarDate(iso ? iso.slice(0, 10) : "")}
      onChange={(date) => onChange(date ? date.toString() : "")}
      isRequired={isRequired}
      errorMessage={errorMessage}
      description={description}
      className={className}
    />
  );
}

// A time of day only: "HH:MM" in and out (empty when not set), shown in the app's locale.
export function TimeInput({
  label,
  value,
  onChange,
  isRequired,
  errorMessage,
  description,
  className,
}: {
  label: string;
  value: string;
  onChange: (time: string) => void;
  isRequired?: boolean;
  errorMessage?: string;
  description?: string;
  className?: string;
}) {
  return (
    <TimeField
      label={label}
      value={toTime(value)}
      onChange={(time) => onChange(timeString(time))}
      isRequired={isRequired}
      errorMessage={errorMessage}
      description={description}
      className={className}
    />
  );
}
