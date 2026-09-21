"use client";

import { useMemo } from "react";
import { Select } from "@vercentlabs/design-system";

import { browserTimezone, timezoneLabel } from "../human";

const COMMON_ZONES = [
  "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Asia/Hong_Kong", "Asia/Riyadh", "Australia/Sydney", "Pacific/Auckland",
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Africa/Johannesburg", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Sao_Paulo", "UTC",
];

// Human names ("India Standard Time (GMT+5:30)"); the canonical IANA id is what the caller stores.
export function TimezoneSelect({ value, onChange, label = "Time zone", className }: { value: string; onChange: (zone: string) => void; label?: string; className?: string }) {
  const options = useMemo(() => {
    const zones = new Set([browserTimezone(), ...COMMON_ZONES, value].filter(Boolean));
    return [...zones].map((zone) => ({ value: zone, label: timezoneLabel(zone) }));
  }, [value]);
  return <Select label={label} options={options} selectedKey={value} onSelectionChange={(key) => onChange(String(key))} className={className} />;
}
