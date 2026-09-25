"use client";

import { TextField } from "@vercentlabs/design-system";

import { browserTimezone, isoToLocalParts, localToIso, timezoneLabel } from "../human";

// Date + time entry with the time zone stated. The value it hands back is the ISO instant the backend already
// stores, so nothing downstream changes; nobody types a timestamp by hand.
export function DateTimeInput({
  label, value, onChange, timeZone, isRequired, errorMessage, description, className, hideZone,
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
  const emit = (date: string, time: string) => onChange(date ? localToIso(date, time || "09:00", zone) : "");
  return (
    <fieldset className={className}>
      <legend className="mb-1 text-sm font-medium text-text">
        {label}
        {isRequired && <span className="text-danger"> *</span>}
      </legend>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,9rem)] gap-2">
        <TextField aria-label={`${label} date`} type="date" value={parts.date} onChange={(date) => emit(date, parts.time)} isRequired={isRequired} />
        <TextField aria-label={`${label} time`} type="time" value={parts.time} onChange={(time) => emit(parts.date, time)} isRequired={isRequired} />
      </div>
      {errorMessage ? <p role="alert" className="mt-1 text-xs text-danger">{errorMessage}</p> : description ? <p className="mt-1 text-xs text-text-muted">{description}</p> : null}
      {!hideZone && <p className="mt-1 text-xs text-text-muted">{timezoneLabel(zone)}</p>}
    </fieldset>
  );
}

// A date only (no time of day): the stored value stays YYYY-MM-DD.
// `value` is typed as string, but a server component that loads the record
// straight from Postgres (rather than through a JSON fetch) hands a DATE
// column across as a real Date instance — RSC serialization preserves it
// as one, and JSON.stringify never runs to coerce it. Guard the same way
// shared/human.ts's own toDate() already does for the identical reason.
export function DateInput({ label, value, onChange, isRequired, errorMessage, className }: { label: string; value: string | Date; onChange: (date: string) => void; isRequired?: boolean; errorMessage?: string; className?: string }) {
  const iso = value instanceof Date ? value.toISOString() : value;
  return <TextField label={label} type="date" value={iso ? iso.slice(0, 10) : ""} onChange={onChange} isRequired={isRequired} errorMessage={errorMessage} className={className} />;
}
